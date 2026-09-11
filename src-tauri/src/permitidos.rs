//! Os caminhos que a janela pode pedir para ler, abrir ou usar como destino.
//!
//! A janela so conhece o disco pelo que o Rust entrega, e o Rust so aceita de
//! volta o que ele mesmo entregou: o que a pessoa escolheu no dialogo, soltou
//! na janela, abriu pelo Explorador, ou o que o proprio programa salvou.
//!
//! Sem isto, um script hostil dentro de um PDF - se um dia algum conseguisse
//! rodar na tela - pediria `ler_arquivo("C:\Users\...\senhas.txt")`, ou
//! `abrir("C:\Windows\System32\cmd.exe")`, ou gravaria na pasta de
//! Inicializar do Windows. Os plugins de `fs` e `shell` ja tinham ficado de
//! fora por isso; esta lista fecha o mesmo buraco nos comandos proprios.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Default)]
pub struct Permitidos(Mutex<HashSet<PathBuf>>);

/// A forma unica de um caminho: `C:\a\..\b.pdf` e `c:\B.PDF` sao o mesmo
/// arquivo, e so o caminho canonico deixa comparar sem ser enganado.
fn chave(caminho: &Path) -> Option<PathBuf> {
    caminho.canonicalize().ok()
}

impl Permitidos {
    pub fn permitir(&self, caminho: &Path) {
        if let (Some(c), Ok(mut lista)) = (chave(caminho), self.0.lock()) {
            lista.insert(c);
        }
    }

    pub fn permitido(&self, caminho: &Path) -> bool {
        let Some(c) = chave(caminho) else {
            return false;
        };
        self.0.lock().map(|lista| lista.contains(&c)).unwrap_or(false)
    }

    /// O caminho, se foi entregue pelo programa; senao, o motivo da recusa.
    pub fn exigir(&self, caminho: &str) -> Result<PathBuf, String> {
        let alvo = PathBuf::from(caminho);
        if self.permitido(&alvo) {
            Ok(alvo)
        } else {
            Err("este arquivo nao foi escolhido neste programa".into())
        }
    }
}

/// O caminho fica dentro da pasta indicada, ja resolvidos `..` e atalhos?
pub fn dentro_de(caminho: &Path, pasta: &Path) -> bool {
    match (caminho.canonicalize(), pasta.canonicalize()) {
        (Ok(alvo), Ok(base)) => alvo != base && alvo.starts_with(base),
        _ => false,
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use std::fs;

    fn pasta(nome: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("greencodes-perm-{nome}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn so_passa_o_que_foi_entregue() {
        let base = pasta("lista");
        let escolhido = base.join("contrato.pdf");
        let outro = base.join("senhas.txt");
        fs::write(&escolhido, b"%PDF").unwrap();
        fs::write(&outro, b"segredo").unwrap();

        let lista = Permitidos::default();
        assert!(!lista.permitido(&escolhido));
        lista.permitir(&escolhido);
        assert!(lista.permitido(&escolhido));
        assert!(lista.exigir(&outro.to_string_lossy()).is_err());

        // O mesmo arquivo escrito de outro jeito continua sendo ele.
        let torto = base.join("..").join(base.file_name().unwrap()).join("CONTRATO.PDF");
        assert!(lista.permitido(&torto));
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn dentro_de_nao_se_engana_com_ponto_ponto() {
        let base = pasta("dentro");
        let filho = base.join("a.pdf");
        fs::write(&filho, b"1").unwrap();
        assert!(dentro_de(&filho, &base));
        assert!(!dentro_de(&base, &base));
        assert!(!dentro_de(&base.join("..").join("..").join("x"), &base));
        let _ = fs::remove_dir_all(base);
    }
}
