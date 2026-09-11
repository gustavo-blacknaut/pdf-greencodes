//! Os processos auxiliares morrem junto com o aplicativo.
//!
//! O `impressora.exe` espera a janela do driver ou o "Salvar como" da
//! impressora virtual, e o motor Python espera o proximo pedido. Fechado o
//! aplicativo, os dois ficavam vivos para tras, sem janela nenhuma: o da
//! impressora segurando o arquivo da fila, e o proximo build falhando com
//! "arquivo em uso".
//!
//! O Windows resolve isso com um Job Object marcado para matar tudo quando a
//! ultima alca dele fecha - e a alca fecha sozinha quando o aplicativo sai,
//! ate num encerramento forcado pelo Gerenciador de Tarefas.
//!
//! So os auxiliares entram no job, e nao o aplicativo inteiro: o que o
//! "Abrir no programa padrao" abre (o Acrobat, o Word) nao pode morrer porque
//! a pessoa fechou o PDF.GreenCodes.

use std::process::Child;

#[cfg(windows)]
mod windows {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;

    type Alca = *mut c_void;

    #[repr(C)]
    #[derive(Default)]
    struct LimitesBasicos {
        limite_de_tempo_por_processo: i64,
        limite_de_tempo_do_job: i64,
        opcoes: u32,
        memoria_minima: usize,
        memoria_maxima: usize,
        processos_ativos: u32,
        afinidade: usize,
        prioridade: u32,
        agendamento: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    struct LimitesEstendidos {
        basicos: LimitesBasicos,
        contadores_de_es: [u64; 6],
        memoria_por_processo: usize,
        memoria_do_job: usize,
        pico_por_processo: usize,
        pico_do_job: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(atributos: *mut c_void, nome: *const u16) -> Alca;
        fn SetInformationJobObject(job: Alca, classe: i32, informacao: *mut c_void, tamanho: u32) -> i32;
        fn AssignProcessToJobObject(job: Alca, processo: Alca) -> i32;
    }

    const MATAR_AO_FECHAR: u32 = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    const LIMITES_ESTENDIDOS: i32 = 9; // JobObjectExtendedLimitInformation

    struct Job(Alca);
    // A alca e so um numero para o kernel: ler de varias threads e seguro.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    static JOB: OnceLock<Option<Job>> = OnceLock::new();

    fn job() -> Option<&'static Job> {
        JOB.get_or_init(|| unsafe {
            let alca = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
            if alca.is_null() {
                return None;
            }
            let mut limites = LimitesEstendidos::default();
            limites.basicos.opcoes = MATAR_AO_FECHAR;
            let ok = SetInformationJobObject(
                alca,
                LIMITES_ESTENDIDOS,
                (&mut limites as *mut LimitesEstendidos).cast(),
                std::mem::size_of::<LimitesEstendidos>() as u32,
            );
            (ok != 0).then_some(Job(alca))
        })
        .as_ref()
    }

    pub fn prender(filho: &std::process::Child) -> bool {
        match job() {
            Some(job) => unsafe { AssignProcessToJobObject(job.0, filho.as_raw_handle().cast()) != 0 },
            None => false,
        }
    }

    #[cfg(test)]
    #[test]
    fn a_estrutura_tem_o_tamanho_que_o_windows_espera() {
        // JOBOBJECT_EXTENDED_LIMIT_INFORMATION tem 144 bytes no Windows 64
        // bits. Um campo fora do lugar e o kernel recusa, ou pior, le errado.
        assert_eq!(std::mem::size_of::<LimitesEstendidos>(), 144);
    }
}

/// Amarra o processo ao aplicativo: se o aplicativo sair, ele sai junto.
///
/// Falhar aqui nao impede o trabalho - o auxiliar so fica sem a garantia de
/// morrer junto, que era como tudo funcionava antes.
pub fn prender(filho: &Child) -> bool {
    #[cfg(windows)]
    {
        windows::prender(filho)
    }
    #[cfg(not(windows))]
    {
        let _ = filho;
        false
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use std::process::{Command, Stdio};

    #[test]
    #[cfg(windows)]
    fn um_filho_entra_no_job() {
        let mut filho = Command::new("cmd")
            .args(["/c", "ping", "-n", "3", "127.0.0.1"])
            .stdout(Stdio::null())
            .spawn()
            .unwrap();
        assert!(prender(&filho), "o Windows recusou o processo no job");
        let _ = filho.kill();
        let _ = filho.wait();
    }
}
