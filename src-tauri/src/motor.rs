//! Conversa com o motor de PDF em Python.
//!
//! Um processo so, vivo enquanto o aplicativo estiver aberto. Abrir um por
//! trabalho custaria uns 300 ms de importacao do PyMuPDF toda vez, o que
//! apareceria na tela em qualquer operacao curta.
//!
//! O protocolo e uma linha de JSON por mensagem: o pedido entra pelo stdin, a
//! resposta e o andamento saem pelo stdout. Linha em vez de servidor HTTP
//! porque o motor morre junto com o aplicativo, sem porta aberta na maquina.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const SEM_JANELA: u32 = 0x0800_0000; // CREATE_NO_WINDOW

/// O que o motor devolve: ou os dados, ou o motivo da falha.
enum Resposta {
    Dados(Value),
    Erro(String),
}

#[derive(Clone, Serialize)]
pub struct Andamento {
    pub id: String,
    pub fracao: f64,
    pub mensagem: String,
}

#[derive(Default)]
struct Interno {
    processo: Option<Child>,
    entrada: Option<ChildStdin>,
    pendentes: HashMap<String, Sender<Resposta>>,
    proximo_id: u64,
    /// Conta quantos processos ja subiram. O leitor de um processo que morreu
    /// so pode limpar o estado se nenhum outro tiver subido no lugar dele.
    geracao: u64,
    /// As ultimas linhas que o Python escreveu no stderr: e o que explica por
    /// que ele morreu, quando morre.
    ultimos_erros: Arc<Mutex<VecDeque<String>>>,
}

/// Quantas linhas do stderr guardar para contar o motivo de uma queda.
const LINHAS_DE_ERRO: usize = 20;

impl Interno {
    /// A mensagem de quando o motor cai: a ultima linha util do stderr, que
    /// no Python e a do erro de verdade, e nao o comeco do traceback.
    fn motivo_da_queda(&self) -> String {
        let ultima = self
            .ultimos_erros
            .lock()
            .ok()
            .and_then(|lista| lista.iter().rev().find(|l| !l.trim().is_empty()).cloned());
        match ultima {
            Some(linha) => format!("o motor encerrou antes de responder: {}", linha.trim()),
            None => "o motor encerrou antes de responder".to_string(),
        }
    }
}

#[derive(Default)]
pub struct Motor {
    interno: Mutex<Interno>,
}

impl Motor {
    /// Sobe o processo se ainda nao estiver de pe.
    ///
    /// O leitor do stdout roda numa thread propria: ele precisa atender
    /// andamento enquanto o pedido original ainda espera resposta.
    fn ligar(&self, app: &AppHandle, interno: &mut Interno) -> Result<(), String> {
        if interno.processo.is_some() {
            return Ok(());
        }

        let raiz = recursos(app)?;
        // pythonw nao abre janela de console: python.exe pisca uma janela
        // preta a cada operacao.
        let python = raiz.join("motor").join("runtime").join("pythonw.exe");
        let script = raiz.join("motor").join("principal.py");

        let mut comando = Command::new(&python);
        comando
            .arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        comando.creation_flags(SEM_JANELA);

        let mut filho = comando
            .spawn()
            .map_err(|e| format!("nao consegui abrir o motor em {:?}: {e}", python))?;
        crate::processos::prender(&filho);

        let saida = filho.stdout.take().ok_or("o motor nao devolveu stdout")?;
        let erros = filho.stderr.take().ok_or("o motor nao devolveu stderr")?;
        interno.entrada = filho.stdin.take();
        interno.processo = Some(filho);
        interno.geracao += 1;
        let geracao = interno.geracao;

        // O stderr precisa ser esvaziado sempre. Cano cheio trava o Python no
        // meio da escrita, e o MuPDF avisa bastante em PDF mal formado: sem
        // isto, um arquivo ruim deixava a ferramenta parada para sempre.
        let guardados = Arc::new(Mutex::new(VecDeque::with_capacity(LINHAS_DE_ERRO)));
        interno.ultimos_erros = Arc::clone(&guardados);
        std::thread::spawn(move || {
            for linha in BufReader::new(erros).lines().map_while(Result::ok) {
                let Ok(mut lista) = guardados.lock() else { break };
                if lista.len() == LINHAS_DE_ERRO {
                    lista.pop_front();
                }
                lista.push_back(linha);
            }
        });

        let app = app.clone();
        std::thread::spawn(move || {
            for linha in BufReader::new(saida).lines().map_while(Result::ok) {
                let Ok(msg) = serde_json::from_str::<Value>(&linha) else {
                    continue;
                };
                let Some(id) = msg.get("id").and_then(Value::as_str).map(str::to_string) else {
                    continue;
                };

                if msg.get("tipo").and_then(Value::as_str) == Some("andamento") {
                    let _ = app.emit(
                        "motor:andamento",
                        Andamento {
                            id,
                            fracao: msg.get("fracao").and_then(Value::as_f64).unwrap_or(0.0),
                            mensagem: msg
                                .get("mensagem")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string(),
                        },
                    );
                    continue;
                }

                let motor = app.state::<Motor>();
                let Ok(mut interno) = motor.interno.lock() else {
                    continue;
                };
                let Some(canal) = interno.pendentes.remove(&id) else {
                    continue;
                };

                let resposta = if msg.get("tipo").and_then(Value::as_str) == Some("erro") {
                    Resposta::Erro(
                        msg.get("erro")
                            .and_then(Value::as_str)
                            .unwrap_or("o motor falhou")
                            .to_string(),
                    )
                } else {
                    Resposta::Dados(msg.get("dados").cloned().unwrap_or_else(|| json!({})))
                };
                let _ = canal.send(resposta);
            }

            // O stdout fechou: o Python morreu. Quem ainda espera resposta
            // ficaria esperando para sempre, e o proximo pedido escreveria num
            // cano quebrado. Solta os dois, a menos que um motor novo ja tenha
            // subido no lugar (o cancelar faz isso).
            let motor = app.state::<Motor>();
            let Ok(mut interno) = motor.interno.lock() else {
                return;
            };
            if interno.geracao != geracao {
                return;
            }
            let motivo = interno.motivo_da_queda();
            if let Some(mut filho) = interno.processo.take() {
                let _ = filho.kill();
                let _ = filho.wait();
            }
            interno.entrada = None;
            for (_, canal) in interno.pendentes.drain() {
                let _ = canal.send(Resposta::Erro(motivo.clone()));
            }
        });

        Ok(())
    }

    pub fn executar(&self, app: &AppHandle, acao: &str, pedido: Value) -> Result<Value, String> {
        let (id, receptor) = {
            let mut interno = self.interno.lock().map_err(|_| "motor travado")?;
            self.ligar(app, &mut interno)?;

            interno.proximo_id += 1;
            let id = interno.proximo_id.to_string();
            let (envia, recebe) = channel();
            interno.pendentes.insert(id.clone(), envia);

            let linha = json!({
                "id": id,
                "acao": acao,
                "arquivos": pedido.get("arquivos").cloned().unwrap_or_else(|| json!([])),
                "opcoes": pedido.get("opcoes").cloned().unwrap_or_else(|| json!({})),
                "senhas": pedido.get("senhas").cloned().unwrap_or_else(|| json!([])),
                "saida": pedido.get("saida").cloned().unwrap_or_else(|| json!("")),
            });

            let entrada = interno.entrada.as_mut().ok_or("o motor nao esta ligado")?;
            writeln!(entrada, "{linha}").map_err(|e| format!("o motor nao aceitou o pedido: {e}"))?;
            entrada.flush().map_err(|e| e.to_string())?;
            (id, recebe)
        };

        // A espera fica fora do cadeado: o leitor precisa do mesmo Mutex para
        // entregar a resposta, e segurar aqui travaria os dois.
        match receptor.recv() {
            Ok(Resposta::Dados(dados)) => Ok(dados),
            Ok(Resposta::Erro(motivo)) => Err(motivo),
            Err(_) => {
                let mut interno = self.interno.lock().map_err(|_| "motor travado")?;
                interno.pendentes.remove(&id);
                Err("o motor encerrou antes de responder".into())
            }
        }
    }

    /// Derruba o motor no meio do trabalho.
    ///
    /// Nao ha como cancelar so um trabalho: o motor atende um de cada vez, e
    /// matar o processo e o unico jeito de parar um desenho de mil paginas na
    /// hora. O proximo pedido sobe outro processo.
    pub fn cancelar(&self) -> bool {
        let Ok(mut interno) = self.interno.lock() else {
            return false;
        };
        let Some(mut filho) = interno.processo.take() else {
            return false;
        };
        let _ = filho.kill();
        interno.entrada = None;
        for (_, canal) in interno.pendentes.drain() {
            let _ = canal.send(Resposta::Erro("cancelado".into()));
        }
        true
    }
}

/// A pasta onde motor e auxiliares moram, empacotados ou em desenvolvimento.
pub fn recursos(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    if let Ok(dir) = app.path().resource_dir() {
        if dir.join("motor").exists() {
            return Ok(dir);
        }
    }
    // Rodando por `tauri dev`, os recursos ainda estao na raiz do projeto.
    let raiz = std::env::current_dir().map_err(|e| e.to_string())?;
    if raiz.join("motor").exists() {
        return Ok(raiz);
    }
    raiz.parent()
        .map(std::path::Path::to_path_buf)
        .ok_or_else(|| "nao achei a pasta do motor".to_string())
}

