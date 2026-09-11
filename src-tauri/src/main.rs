// A janela do aplicativo nao deve abrir um console atras dela no Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod arquivos;
mod impressao;
mod motor;
mod permitidos;
mod processos;
mod resultados;
mod sistema;
mod uso;

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::DialogExt;

use impressao::{OpcoesDeImpressao, Preparada, Sessoes};
use motor::Motor;
use permitidos::{dentro_de, Permitidos};

/// Os arquivos que o Windows mandou abrir e a interface ainda nao pegou.
///
/// Existe porque o sistema entrega os caminhos antes de a pagina carregar: sem
/// a fila, um clique duplo num PDF abria o aplicativo vazio.
#[derive(Default)]
struct Fila(Mutex<Vec<String>>);

/// O que o programa abre: o que o seletor, o arrastar e o "Abrir com"
/// aceitam. Tem que andar junto com o `accept` das ferramentas.
const EXTENSOES_ACEITAS: &[&str] = &[
    "pdf", "jpg", "jpeg", "png", "webp", "avif", "gif", "bmp", "heic", "heif", "docx", "xlsx", "pptx",
    "txt",
];

/* --------------------------------------------------------------- utilidades */

/// Le um cabecalho da chamada, desfazendo o escape do texto.
///
/// Os bytes viajam como corpo cru - e o unico jeito de mandar 50 MB para o
/// processo sem transformar em texto -, entao nome e destino vao pelo
/// cabecalho. Cabecalho HTTP so aceita ASCII, e nome de arquivo em portugues
/// nao e ASCII: por isso vao codificados.
fn cabecalho(pedido: &Request<'_>, chave: &str) -> Option<String> {
    let bruto = pedido.headers().get(chave)?.to_str().ok()?;
    Some(percent_decode(bruto))
}

fn percent_decode(texto: &str) -> String {
    let bytes = texto.as_bytes();
    let mut saida: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let alto = (bytes[i + 1] as char).to_digit(16);
            let baixo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(a), Some(b)) = (alto, baixo) {
                saida.push((a * 16 + b) as u8);
                i += 3;
                continue;
            }
        }
        saida.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&saida).to_string()
}

/// Os bytes que a janela mandou.
///
/// Pelo canal normal chegam crus. Pelo reserva, que o Tauri usa quando o
/// normal falha, chegam como lista de numeros no JSON: aceitar os dois e o
/// que impede um arquivo de virar erro so porque o canal mudou.
fn corpo(pedido: &Request<'_>) -> Result<Vec<u8>, String> {
    match pedido.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(Value::Array(lista)) => lista
            .iter()
            .map(|n| n.as_u64().filter(|n| *n <= 255).map(|n| n as u8))
            .collect::<Option<Vec<u8>>>()
            .ok_or_else(|| "os bytes do arquivo chegaram estragados".to_string()),
        _ => Err("esperava os bytes do arquivo".into()),
    }
}

/// Abre um dialogo do sistema sem travar a janela.
///
/// O dialogo responde por retorno de chamada, e quem espera precisa estar fora
/// da linha principal: esperar nela seguraria o proprio laco de eventos que
/// desenha o dialogo, e nada mais aconteceria.
async fn esperar<T: Send + 'static>(
    abrir: impl FnOnce(std::sync::mpsc::Sender<T>) + Send + 'static,
) -> Option<T> {
    let (envia, recebe) = std::sync::mpsc::channel();
    abrir(envia);
    tauri::async_runtime::spawn_blocking(move || recebe.recv().ok())
        .await
        .ok()
        .flatten()
}

/// Roda um trabalho demorado fora da linha principal.
///
/// No Tauri, comando sem `async` roda na mesma linha que desenha a janela: um
/// desenho de 141 paginas no motor deixava o programa "Nao respondendo", sem
/// barra de progresso, ate acabar. Tudo que toca disco, processo ou motor
/// passa por aqui.
async fn em_segundo_plano<T: Send + 'static>(
    trabalho: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(trabalho)
        .await
        .map_err(|e| format!("o trabalho foi interrompido: {e}"))
}

fn resposta_de<T: std::fmt::Display>(resultado: Result<PathBuf, T>) -> Value {
    match resultado {
        Ok(caminho) => json!({ "ok": true, "caminho": caminho.to_string_lossy() }),
        Err(erro) => json!({ "ok": false, "erro": erro.to_string() }),
    }
}

/// Grava a saida e deixa a janela voltar a ela depois (abrir, mostrar na
/// pasta), contando o arquivo no uso.
fn guardado(app: &AppHandle, resultado: Result<PathBuf, String>) -> Value {
    if let Ok(caminho) = &resultado {
        app.state::<Permitidos>().permitir(caminho);
        app.state::<uso::Registro>().salvou(app, 1);
    }
    resposta_de(resultado)
}

/* ------------------------------------------------------------- aplicativo */

#[tauri::command]
fn versao(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/* ---------------------------------------------------------------- arquivo */

#[derive(Serialize, Clone)]
struct Escolhido {
    nome: String,
    caminho: String,
    tamanho: u64,
}

/// Descreve um arquivo que a pessoa entregou ao programa, e o anota como
/// permitido. Pasta, atalho quebrado ou formato que o programa nao abre ficam
/// de fora.
fn entregue(app: &AppHandle, caminho: &Path) -> Option<Escolhido> {
    let extensao = caminho
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_lowercase();
    if !EXTENSOES_ACEITAS.contains(&extensao.as_str()) {
        return None;
    }
    let dados = caminho.metadata().ok().filter(|m| m.is_file())?;
    app.state::<Permitidos>().permitir(caminho);
    Some(Escolhido {
        nome: caminho
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("arquivo")
            .to_string(),
        caminho: caminho.to_string_lossy().to_string(),
        tamanho: dados.len(),
    })
}

/// A interface avisou que esta pronta; devolve o que estava na fila.
#[tauri::command]
fn sistema_pronto(app: AppHandle, fila: State<'_, Fila>) -> Vec<Escolhido> {
    let Ok(mut pendentes) = fila.0.lock() else {
        return Vec::new();
    };
    let caminhos: Vec<String> = pendentes.drain(..).collect();
    caminhos.iter().filter_map(|c| entregue(&app, Path::new(c))).collect()
}

/// Abre o dialogo nativo de salvar e grava o arquivo escolhido.
#[tauri::command]
async fn salvar_arquivo(app: AppHandle, pedido: Request<'_>) -> Result<Value, String> {
    let bytes = corpo(&pedido)?;
    let nome = cabecalho(&pedido, "nome").unwrap_or_else(|| "arquivo.pdf".into());
    let nome = arquivos::nome_seguro(&nome);

    let extensao = Path::new(&nome)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("pdf")
        .to_lowercase();

    let dialogo = app.clone();
    let escolha = esperar(move |envia| {
        dialogo
            .dialog()
            .file()
            .set_title("Salvar arquivo")
            .set_file_name(&nome)
            .add_filter(arquivos::rotulo_da_extensao(&extensao), &[&extensao])
            .add_filter("Todos os arquivos", &["*"])
            .save_file(move |caminho| {
                let _ = envia.send(caminho);
            });
    })
    .await
    .flatten();

    let Some(destino) = escolha.and_then(|c| c.into_path().ok()) else {
        return Ok(json!({ "ok": false, "cancelado": true }));
    };

    Ok(guardado(&app, arquivos::gravar(&destino, &bytes).map(|()| destino.clone())))
}

/// Grava sem perguntar nada, solto em Downloads, com nome de ID.
#[tauri::command]
async fn salvar_numerado(app: AppHandle, pedido: Request<'_>) -> Result<Value, String> {
    let bytes = corpo(&pedido)?;
    let nome = cabecalho(&pedido, "nome").unwrap_or_else(|| "arquivo.pdf".into());
    let apagar = cabecalho(&pedido, "apagar").as_deref() == Some("1");
    em_segundo_plano(move || {
        let resultado = resultados::salvar(&app, &nome, &bytes, apagar);
        guardado(&app, resultado)
    })
    .await
}

#[tauri::command(async)]
fn auto_exclusao(app: AppHandle, caminho: String, ligado: bool) -> Value {
    if let Err(erro) = app.state::<Permitidos>().exigir(&caminho) {
        return json!({ "ok": false, "erro": erro });
    }
    let feito = if ligado {
        resultados::marcar(&app, &caminho)
    } else {
        resultados::manter(&app, &caminho)
    };
    match feito {
        Ok(()) => json!({ "ok": true, "caminho": caminho }),
        Err(erro) => json!({ "ok": false, "erro": erro }),
    }
}

/// Escolhe a pasta de destino de uma vez, para gravar varios arquivos nela.
#[tauri::command]
async fn escolher_pasta(app: AppHandle) -> Value {
    let dialogo = app.clone();
    let escolha = esperar(move |envia| {
        dialogo
            .dialog()
            .file()
            .set_title("Escolher a pasta de destino")
            .pick_folder(move |pasta| {
                let _ = envia.send(pasta);
            });
    })
    .await
    .flatten();

    match escolha.and_then(|c| c.into_path().ok()) {
        Some(pasta) => {
            // So a pasta que a pessoa escolheu aceita gravacao pelo `gravar_em`.
            app.state::<Permitidos>().permitir(&pasta);
            json!({ "ok": true, "caminho": pasta.to_string_lossy() })
        }
        None => json!({ "ok": false, "cancelado": true }),
    }
}

/// Grava um arquivo numa pasta ja escolhida no dialogo.
#[tauri::command]
async fn gravar_em(app: AppHandle, pedido: Request<'_>) -> Result<Value, String> {
    let bytes = corpo(&pedido)?;
    let pasta = cabecalho(&pedido, "pasta").ok_or("faltou a pasta de destino")?;
    let nome = cabecalho(&pedido, "nome").ok_or("faltou o nome do arquivo")?;
    // Sem esta conferencia, a janela escolheria a pasta sozinha - a de
    // Inicializar do Windows, por exemplo.
    let pasta = app.state::<Permitidos>().exigir(&pasta)?;

    // Nunca sobrescreve: quem manda trinta paginas separadas para a mesma
    // pasta nao espera que a segunda apague a primeira.
    em_segundo_plano(move || {
        let destino = arquivos::caminho_livre(&pasta, &nome);
        let resultado = arquivos::gravar(&destino, &bytes).map(|()| destino.clone());
        guardado(&app, resultado)
    })
    .await
}

/// Dialogo nativo de abrir. Devolve nome, caminho e tamanho, sem ler nada.
///
/// Ler o conteudo aqui era o que deixava a tela muda: com um arquivo de
/// 400 MB, entre fechar o dialogo e o arquivo aparecer passavam dezenas de
/// segundos sem nada na tela.
#[tauri::command]
async fn escolher_arquivos(app: AppHandle, extensoes: Option<Vec<String>>) -> Vec<Escolhido> {
    let lista: Vec<String> = extensoes
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| EXTENSOES_ACEITAS.iter().map(|e| e.to_string()).collect())
        .iter()
        .map(|e| e.trim_start_matches('.').to_lowercase())
        .collect();

    let dialogo = app.clone();
    let escolha = esperar(move |envia| {
        let referencias: Vec<&str> = lista.iter().map(String::as_str).collect();
        dialogo
            .dialog()
            .file()
            .set_title("Escolher arquivos")
            .add_filter("Arquivos aceitos", &referencias)
            .pick_files(move |arquivos| {
                let _ = envia.send(arquivos);
            });
    })
    .await
    .flatten();

    escolha
        .unwrap_or_default()
        .into_iter()
        .filter_map(|c| c.into_path().ok())
        .filter_map(|caminho| entregue(&app, &caminho))
        .collect()
}

/// Le um arquivo em pedacos, avisando o quanto ja leu.
///
/// Em pedacos, e nao de uma vez, para a barra andar de verdade: uma leitura
/// inteira de 400 MB fica muda ate terminar. So le o que a pessoa entregou.
#[tauri::command]
async fn ler_arquivo(app: AppHandle, caminho: String) -> Result<Response, String> {
    app.state::<Permitidos>().exigir(&caminho)?;
    em_segundo_plano(move || ler_em_pedacos(&app, &caminho)).await?
}

fn ler_em_pedacos(app: &AppHandle, caminho: &str) -> Result<Response, String> {
    let alvo = Path::new(caminho);
    let total = alvo
        .metadata()
        .map_err(|_| "arquivo nao encontrado".to_string())?
        .len();

    let mut arquivo = File::open(alvo).map_err(|e| format!("nao consegui abrir: {e}"))?;
    let mut conteudo: Vec<u8> = Vec::with_capacity(total as usize);
    let mut pedaco = vec![0u8; 4 * 1024 * 1024];
    let mut lidos: u64 = 0;
    let mut ultimo_aviso = 0u64;

    loop {
        let quanto = arquivo
            .read(&mut pedaco)
            .map_err(|e| format!("falha ao ler: {e}"))?;
        if quanto == 0 {
            break;
        }
        conteudo.extend_from_slice(&pedaco[..quanto]);
        lidos += quanto as u64;

        // Um aviso a cada 2%: mais que isso so enche a fila de mensagens.
        let marca = if total == 0 { 0 } else { lidos * 50 / total };
        if marca != ultimo_aviso {
            ultimo_aviso = marca;
            let _ = app.emit(
                "arquivo:lendo",
                json!({ "caminho": caminho, "lidos": lidos, "total": total }),
            );
        }
    }

    Ok(Response::new(conteudo))
}

/// Abre o arquivo no programa padrao do Windows.
///
/// So o que o programa entregou: aberto pelo Windows, um `.exe` roda.
#[tauri::command]
fn abrir(app: AppHandle, caminho: String) -> Value {
    if let Err(erro) = app.state::<Permitidos>().exigir(&caminho) {
        return json!({ "ok": false, "erro": erro });
    }
    match tauri_plugin_opener::open_path(&caminho, None::<&str>) {
        Ok(()) => json!({ "ok": true, "caminho": caminho }),
        Err(erro) => json!({ "ok": false, "erro": erro.to_string() }),
    }
}

/// Abre numa janela do proprio programa.
///
/// O WebView2 tem leitor de PDF embutido, entao e so carregar o arquivo. Nao
/// serve para imprimir - ali sairia a tela do leitor, e nao o documento -,
/// mas para conferir o resultado esta de bom tamanho.
///
/// Precisa ser `async`: criar janela de dentro de um comando que roda na linha
/// principal trava o Windows para sempre (wry#583).
#[tauri::command]
async fn abrir_aqui(app: AppHandle, caminho: String) -> Value {
    if let Err(erro) = app.state::<Permitidos>().exigir(&caminho) {
        return json!({ "ok": false, "erro": erro });
    }
    let alvo = Path::new(&caminho);

    let titulo = alvo
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Documento")
        .to_string();
    let endereco = format!("file:///{}", caminho.replace('\\', "/"));
    let Ok(url) = endereco.parse() else {
        return abrir(app, caminho);
    };

    // Um rotulo por arquivo, e sem acento: o rotulo da janela vira nome de
    // recurso interno e so aceita letras, numeros, hifen e sublinhado.
    let rotulo = format!("leitor-{}", resultados::novo_id());

    match WebviewWindowBuilder::new(&app, rotulo, WebviewUrl::External(url))
        .title(titulo)
        .inner_size(900.0, 1000.0)
        .center()
        .build()
    {
        Ok(_) => json!({ "ok": true, "caminho": caminho }),
        // Driver de video antigo e politica de empresa conseguem impedir uma
        // segunda janela. Nesse caso o programa padrao do sistema resolve.
        Err(_) => abrir(app, caminho),
    }
}

/// Abre no navegador padrao do sistema.
#[tauri::command]
fn abrir_no_navegador(app: AppHandle, caminho: String) -> Value {
    if let Err(erro) = app.state::<Permitidos>().exigir(&caminho) {
        return json!({ "ok": false, "erro": erro });
    }
    // Barras normais: e o que o navegador entende num endereco file://.
    let endereco = format!("file:///{}", caminho.replace('\\', "/"));
    match tauri_plugin_opener::open_url(&endereco, None::<&str>) {
        Ok(()) => json!({ "ok": true, "caminho": caminho }),
        Err(erro) => json!({ "ok": false, "erro": erro.to_string() }),
    }
}

#[tauri::command]
fn revelar(app: AppHandle, caminho: String) -> bool {
    app.state::<Permitidos>().exigir(&caminho).is_ok()
        && tauri_plugin_opener::reveal_item_in_dir(&caminho).is_ok()
}

/// Abre a pasta onde os resultados sao salvos: a propria Downloads.
///
/// "Onde foi parar o arquivo" e a pergunta mais comum depois de rodar alguma
/// coisa, e todo resultado salvo cai ali.
#[tauri::command]
fn abrir_pasta_dos_resultados(app: AppHandle) -> Value {
    match resultados::pasta(&app) {
        Ok(pasta) => match tauri_plugin_opener::open_path(&pasta, None::<&str>) {
            Ok(()) => json!({ "ok": true, "caminho": pasta.to_string_lossy() }),
            Err(erro) => json!({ "ok": false, "erro": erro.to_string() }),
        },
        Err(erro) => json!({ "ok": false, "erro": erro }),
    }
}

/* ------------------------------------------------------------------ motor */

/// A pasta onde ficam as pastas de trabalho do motor.
fn temporarias_do_motor() -> PathBuf {
    std::env::temp_dir().join("pdf-greencodes")
}

/// Uma pasta de trabalho do motor, ja existente.
fn pasta_de_trabalho(pasta: &str) -> Result<PathBuf, String> {
    let alvo = PathBuf::from(pasta);
    if dentro_de(&alvo, &temporarias_do_motor()) {
        Ok(alvo)
    } else {
        Err("pasta de trabalho do motor invalida".into())
    }
}

/// O motor so trabalha em cima do que e dele ou do que a pessoa entregou.
///
/// Sem isto, a janela mandaria o motor abrir qualquer PDF do disco e depois
/// leria o resultado de volta - o mesmo buraco do `ler_arquivo`, por outra
/// porta.
fn conferir_pedido(app: &AppHandle, pedido: &Value) -> Result<(), String> {
    let permitidos = app.state::<Permitidos>();
    let nossa = temporarias_do_motor();
    for arquivo in pedido.get("arquivos").and_then(Value::as_array).into_iter().flatten() {
        let caminho = arquivo.as_str().ok_or("caminho de arquivo invalido")?;
        let alvo = Path::new(caminho);
        if !dentro_de(alvo, &nossa) && !permitidos.permitido(alvo) {
            return Err("o motor so abre arquivo escolhido neste programa".into());
        }
    }
    if let Some(saida) = pedido.get("saida").and_then(Value::as_str).filter(|s| !s.is_empty()) {
        let pai = Path::new(saida).parent().unwrap_or(Path::new(""));
        if !dentro_de(pai, &nossa) && pai.canonicalize().ok() != nossa.canonicalize().ok() {
            return Err("o motor so grava na pasta de trabalho dele".into());
        }
    }
    Ok(())
}

#[tauri::command]
async fn motor_executar(app: AppHandle, acao: String, pedido: Value) -> Result<Value, String> {
    conferir_pedido(&app, &pedido)?;
    em_segundo_plano(move || app.state::<Motor>().executar(&app, &acao, pedido)).await?
}

#[tauri::command]
fn motor_cancelar(motor: State<'_, Motor>) -> bool {
    motor.cancelar()
}

/// Uma pasta temporaria por trabalho.
///
/// O motor trabalha com arquivo em disco; a interface trabalha com bytes na
/// memoria. Esta pasta e a ponte entre os dois mundos.
#[tauri::command]
fn motor_pasta_temporaria() -> Result<String, String> {
    let pasta = temporarias_do_motor().join(format!("motor-{}", resultados::novo_id()));
    std::fs::create_dir_all(&pasta).map_err(|e| e.to_string())?;
    Ok(pasta.to_string_lossy().to_string())
}

#[tauri::command]
async fn motor_gravar_entrada(pedido: Request<'_>) -> Result<String, String> {
    let bytes = corpo(&pedido)?;
    let pasta = pasta_de_trabalho(&cabecalho(&pedido, "pasta").ok_or("faltou a pasta temporaria")?)?;
    let nome = cabecalho(&pedido, "nome").ok_or("faltou o nome do arquivo")?;
    em_segundo_plano(move || {
        let destino = pasta.join(arquivos::nome_seguro(&nome));
        arquivos::gravar(&destino, &bytes)?;
        Ok(destino.to_string_lossy().to_string())
    })
    .await?
}

/// Poe na pasta de trabalho um arquivo grande que a pessoa escolheu, sem
/// passar pela janela.
///
/// Um link fisico e instantaneo e nao gasta disco: e o mesmo arquivo com dois
/// nomes. So existe no mesmo disco; entre discos, copia - ainda assim de
/// disco para disco, sem os 2 GB atravessarem a memoria da tela.
///
/// E o link, e nao o original, que o motor recebe: a saida nasce ao lado da
/// entrada, e nascer ao lado do original encheria a pasta da pessoa.
#[tauri::command]
async fn motor_vincular_entrada(app: AppHandle, pasta: String, caminho: String) -> Result<String, String> {
    let origem = app.state::<Permitidos>().exigir(&caminho)?;
    let pasta = pasta_de_trabalho(&pasta)?;
    em_segundo_plano(move || {
        let nome = origem
            .file_name()
            .and_then(|n| n.to_str())
            .map(arquivos::nome_seguro)
            .unwrap_or_else(|| "entrada.pdf".into());
        let destino = arquivos::caminho_livre(&pasta, &nome);
        if std::fs::hard_link(&origem, &destino).is_err() {
            std::fs::copy(&origem, &destino).map_err(|e| format!("nao consegui preparar o arquivo: {e}"))?;
        }
        Ok(destino.to_string_lossy().to_string())
    })
    .await?
}

#[tauri::command]
async fn motor_ler_saida(caminho: String) -> Result<Response, String> {
    if !dentro_de(Path::new(&caminho), &temporarias_do_motor()) {
        return Err("so da para ler o que o motor gravou".into());
    }
    em_segundo_plano(move || {
        std::fs::read(&caminho)
            .map(Response::new)
            .map_err(|e| format!("nao consegui ler a saida do motor: {e}"))
    })
    .await?
}

/// Leva direto para Downloads o que o motor gravou, sem passar pela janela.
///
/// E como o resultado de um arquivo de 2 GB chega na pasta da pessoa: a tela
/// nunca segura os bytes, so recebe onde o arquivo foi parar.
#[tauri::command]
async fn motor_entregar(app: AppHandle, caminho: String) -> Result<Value, String> {
    let origem = PathBuf::from(&caminho);
    if !dentro_de(&origem, &temporarias_do_motor()) {
        return Err("so da para entregar o que o motor gravou".into());
    }
    em_segundo_plano(move || {
        let destino = resultados::entregar(&app, &origem)?;
        let tamanho = destino.metadata().map(|m| m.len()).unwrap_or(0);
        let mut resposta = guardado(&app, Ok(destino));
        resposta["tamanho"] = json!(tamanho);
        Ok(resposta)
    })
    .await?
}

/// So apaga o que e nosso: uma pasta de trabalho, dentro da temporaria do
/// motor. Conferir so o nome nao bastava - a pasta do proprio projeto,
/// `Desktop\pdf-greencodes-app`, passava na conferencia.
fn pode_limpar(pasta: &Path) -> bool {
    dentro_de(pasta, &temporarias_do_motor())
}

#[tauri::command]
async fn motor_limpar(pasta: String) -> Result<bool, String> {
    em_segundo_plano(move || {
        let alvo = Path::new(&pasta);
        pode_limpar(alvo) && std::fs::remove_dir_all(alvo).is_ok()
    })
    .await
}

/* -------------------------------------------------------------- impressao */

/// Impressoras que o Windows enxerga: locais, de rede e as virtuais.
///
/// O auxiliar devolve tambem o que cada uma aceita - papeis, bandejas, cor,
/// duplex e o maximo de copias. A tela usa isso para nao oferecer papel que a
/// maquina nao tem.
#[tauri::command]
async fn listar_impressoras(app: AppHandle) -> Result<Value, String> {
    // Impressora de rede desligada faz o Windows demorar segundos para
    // responder, e isso nao pode segurar a janela.
    let saida = em_segundo_plano(move || impressao::chamar(&app, &["listar".to_string()])).await??;
    Ok(saida
        .get("impressoras")
        .cloned()
        .unwrap_or_else(|| json!([])))
}

#[tauri::command]
fn preferencias_da_impressora(impressora: String) -> Value {
    match sistema::preferencias_da_impressora(&impressora) {
        Ok(()) => json!({ "ok": true }),
        Err(erro) => json!({ "ok": false, "erro": erro }),
    }
}

#[tauri::command]
fn impressao_preparar(sessoes: State<'_, Sessoes>) -> Result<Preparada, String> {
    sessoes.preparar()
}

#[tauri::command]
async fn impressao_pagina(app: AppHandle, pedido: Request<'_>) -> Result<Value, String> {
    let bytes = corpo(&pedido)?;
    let id = cabecalho(&pedido, "sessao").ok_or("faltou a sessao de impressao")?;
    let indice: u32 = cabecalho(&pedido, "indice")
        .and_then(|i| i.parse().ok())
        .ok_or("faltou o numero da folha")?;
    em_segundo_plano(move || app.state::<Sessoes>().pagina(&id, indice, bytes)).await??;
    Ok(json!({ "ok": true }))
}

/// Manda para a impressora. Pode abrir a janela do driver antes, e o spooler
/// pode levar minutos com muitas folhas: nada disso pode segurar a janela.
#[tauri::command]
async fn impressao_enviar(
    app: AppHandle,
    id: String,
    opcoes: Option<OpcoesDeImpressao>,
    nome: Option<String>,
) -> Result<Value, String> {
    let opcoes = opcoes.unwrap_or_default();
    // Imprimir em arquivo e para impressora virtual e para prova sem papel:
    // so dentro da pasta temporaria, senao a janela escolheria onde o driver
    // escreve - por cima de qualquer arquivo do disco.
    if let Some(destino) = opcoes.arquivo.as_deref().filter(|a| !a.trim().is_empty()) {
        let pai = Path::new(destino).parent().unwrap_or(Path::new(""));
        if !dentro_de(pai, &std::env::temp_dir()) {
            return Err("imprimir em arquivo so vale dentro da pasta temporaria".into());
        }
    }
    em_segundo_plano(move || app.state::<Sessoes>().enviar(&app, &id, opcoes, nome)).await?
}

#[tauri::command(async)]
fn impressao_descartar(sessoes: State<'_, Sessoes>, id: String) -> Result<Value, String> {
    let _ = sessoes.descartar(&id);
    Ok(json!({ "ok": true }))
}

/* -------------------------------------------------------------------- uso */

#[tauri::command]
async fn uso_registrar(app: AppHandle, evento: Value) -> Result<(), String> {
    let evento: uso::Evento = serde_json::from_value(evento).map_err(|e| format!("evento de uso invalido: {e}"))?;
    em_segundo_plano(move || app.state::<uso::Registro>().registrar(&app, evento)).await?
}

#[tauri::command]
async fn uso_ler(app: AppHandle) -> Result<uso::Uso, String> {
    em_segundo_plano(move || app.state::<uso::Registro>().ler(&app)).await?
}

#[tauri::command]
async fn uso_zerar(app: AppHandle) -> Result<uso::Uso, String> {
    em_segundo_plano(move || app.state::<uso::Registro>().zerar(&app)).await?
}

/* ------------------------------------------------------------------ sistema */

// Cada um destes roda o `reg.exe` uma ou varias vezes: ligar o menu do botao
// direito sao quinze processos seguidos.

#[tauri::command]
async fn integracao_consultar() -> Result<bool, String> {
    em_segundo_plano(sistema::menu_ativo).await
}

#[tauri::command]
async fn integracao_definir(ligado: bool) -> Result<bool, String> {
    em_segundo_plano(move || sistema::definir_menu(ligado)).await
}

#[tauri::command]
async fn inicio_consultar() -> Result<bool, String> {
    em_segundo_plano(sistema::inicio_ativo).await
}

#[tauri::command]
async fn inicio_definir(ligado: bool) -> Result<bool, String> {
    em_segundo_plano(move || sistema::definir_inicio(ligado)).await
}

/* --------------------------------------------------------------- bandeja */

/// Icone ao lado do relogio, com o basico para nao precisar da janela.
///
/// Existe porque o aplicativo pode comecar com o Windows: sem um icone
/// visivel, um programa que abre escondido nao teria como ser aberto.
fn montar_bandeja(app: &AppHandle) -> tauri::Result<()> {
    let abrir = MenuItem::with_id(app, "abrir", "Abrir o PDF.GreenCodes", true, None::<&str>)?;
    let pasta = MenuItem::with_id(app, "pasta", "Abrir a pasta Downloads", true, None::<&str>)?;
    let sair = MenuItem::with_id(app, "sair", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&abrir, &pasta, &sair])?;

    let mut construtor = TrayIconBuilder::with_id("principal")
        .tooltip("PDF.GreenCodes")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, evento| match evento.id().as_ref() {
            "abrir" => mostrar_janela(app),
            "pasta" => {
                abrir_pasta_dos_resultados(app.clone());
            }
            "sair" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|bandeja, evento| {
            if let tauri::tray::TrayIconEvent::DoubleClick { .. } = evento {
                mostrar_janela(bandeja.app_handle());
            }
        });

    if let Some(icone) = app.default_window_icon() {
        construtor = construtor.icon(icone.clone());
    }
    construtor.build(app)?;
    Ok(())
}

fn mostrar_janela(app: &AppHandle) {
    if let Some(janela) = app.get_webview_window("principal") {
        let _ = janela.show();
        let _ = janela.unminimize();
        let _ = janela.set_focus();
    }
}

/* ------------------------------------------------------------------ start */

/// Os caminhos de arquivo que vieram na linha de comando.
///
/// Filtrar por extensao evita que um sinalizador do proprio Windows - ou o
/// nosso `--oculto` - seja tratado como arquivo para abrir.
fn arquivos_dos_argumentos<I: IntoIterator<Item = String>>(argumentos: I) -> Vec<String> {
    argumentos
        .into_iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .filter(|arg| {
            let extensao = Path::new(arg)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or_default()
                .to_lowercase();
            EXTENSOES_ACEITAS.contains(&extensao.as_str()) && Path::new(arg).exists()
        })
        .collect()
}

/// Arquivo arrastado para a janela.
///
/// O Tauri pega o arrastar antes da pagina - no Windows, a pagina nunca
/// recebe o arquivo solto, e a area "Solte seu arquivo aqui" nao fazia nada.
/// O que chega aqui e o caminho, e ele segue o mesmo trilho do dialogo:
/// inclusive o de arquivo grande, que nao passa pela memoria da tela.
fn ao_arrastar(app: &AppHandle, evento: &DragDropEvent) {
    match evento {
        DragDropEvent::Enter { .. } => {
            let _ = app.emit("sistema:arrastando", true);
        }
        DragDropEvent::Leave => {
            let _ = app.emit("sistema:arrastando", false);
        }
        DragDropEvent::Drop { paths, .. } => {
            let _ = app.emit("sistema:arrastando", false);
            let soltos: Vec<Escolhido> = paths.iter().filter_map(|p| entregue(app, p)).collect();
            if !soltos.is_empty() {
                let _ = app.emit("sistema:soltar-arquivos", soltos);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn cabecalho_desfaz_o_acento() {
        assert_eq!(percent_decode("Relat%C3%B3rio%20final.pdf"), "Relatório final.pdf");
        assert_eq!(percent_decode("sem-escape.pdf"), "sem-escape.pdf");
        // Escape quebrado passa como veio, sem derrubar a chamada.
        assert_eq!(percent_decode("100%zz"), "100%zz");
        assert_eq!(percent_decode("fim%"), "fim%");
    }

    #[test]
    fn limpar_so_apaga_pasta_de_trabalho_do_motor() {
        let nossa = temporarias_do_motor();
        let trabalho = nossa.join(format!("teste-limpar-{}", std::process::id()));
        std::fs::create_dir_all(&trabalho).unwrap();
        assert!(pode_limpar(&trabalho));

        // A propria raiz das temporarias nao: apagaria o trabalho de outra janela.
        assert!(!pode_limpar(&nossa));

        // Uma pasta qualquer com o nome parecido nao, e era o furo de antes.
        let parecida = std::env::temp_dir().join(format!("pdf-greencodes-app-{}", std::process::id()));
        std::fs::create_dir_all(&parecida).unwrap();
        assert!(!pode_limpar(&parecida));

        // Subir com ".." tambem nao escapa.
        assert!(!pode_limpar(&trabalho.join("..").join("..")));
        assert!(!pode_limpar(Path::new(r"C:\nao\existe\pdf-greencodes")));

        let _ = std::fs::remove_dir_all(&trabalho);
        let _ = std::fs::remove_dir_all(&parecida);
    }

    #[test]
    fn pasta_de_trabalho_so_aceita_a_do_motor() {
        let trabalho = temporarias_do_motor().join(format!("teste-pasta-{}", std::process::id()));
        std::fs::create_dir_all(&trabalho).unwrap();
        assert!(pasta_de_trabalho(&trabalho.to_string_lossy()).is_ok());
        let inicializar = std::env::var("APPDATA").unwrap_or_default();
        assert!(pasta_de_trabalho(&inicializar).is_err());
        assert!(pasta_de_trabalho(r"C:\Windows").is_err());
        let _ = std::fs::remove_dir_all(&trabalho);
    }

    #[test]
    fn argumentos_so_trazem_arquivo_que_existe_e_e_aceito() {
        let pasta = std::env::temp_dir().join(format!("greencodes-args-{}", std::process::id()));
        std::fs::create_dir_all(&pasta).unwrap();
        let pdf = pasta.join("conta.PDF");
        let exe = pasta.join("virus.exe");
        std::fs::write(&pdf, b"%PDF").unwrap();
        std::fs::write(&exe, b"MZ").unwrap();

        let recebidos = arquivos_dos_argumentos(vec![
            "programa.exe".to_string(),
            "--oculto".to_string(),
            pdf.to_string_lossy().to_string(),
            exe.to_string_lossy().to_string(),
            pasta.join("sumiu.pdf").to_string_lossy().to_string(),
        ]);
        assert_eq!(recebidos, vec![pdf.to_string_lossy().to_string()]);
        let _ = std::fs::remove_dir_all(&pasta);
    }
}

fn main() {
    tauri::Builder::default()
        // Segunda copia do programa nao sobe: os arquivos que ela receberia
        // vao para a janela que ja esta aberta.
        .plugin(tauri_plugin_single_instance::init(|app, argumentos, _pasta| {
            mostrar_janela(app);
            let novos: Vec<Escolhido> = arquivos_dos_argumentos(argumentos)
                .iter()
                .filter_map(|c| entregue(app, Path::new(c)))
                .collect();
            if !novos.is_empty() {
                let _ = app.emit("sistema:abrir-arquivos", novos);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Motor::default())
        .manage(Sessoes::default())
        .manage(Fila::default())
        .manage(Permitidos::default())
        .manage(uso::Registro::default())
        .setup(|app| {
            let alca = app.handle().clone();

            let iniciais = arquivos_dos_argumentos(std::env::args());
            let escondido = std::env::args().any(|a| a == "--oculto") && iniciais.is_empty();
            if let Ok(mut fila) = app.state::<Fila>().0.lock() {
                fila.extend(iniciais);
            }

            if !escondido {
                mostrar_janela(&alca);
            }

            montar_bandeja(&alca)?;
            resultados::iniciar_varredura(&alca);
            // Fora da linha principal: sao alguns `reg.exe`, e a janela ja
            // pode aparecer enquanto isso.
            std::thread::spawn(sistema::atualizar_caminhos);
            Ok(())
        })
        .on_window_event(|janela, evento| {
            if janela.label() != "principal" {
                return;
            }
            match evento {
                // Fechar a janela guarda o aplicativo na bandeja, e nao encerra:
                // o motor Python leva uns 300 ms para subir, e quem fecha entre
                // um trabalho e outro nao deveria pagar isso de novo.
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = janela.hide();
                }
                WindowEvent::DragDrop(arraste) => ao_arrastar(janela.app_handle(), arraste),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            versao,
            sistema_pronto,
            salvar_arquivo,
            salvar_numerado,
            auto_exclusao,
            escolher_pasta,
            gravar_em,
            escolher_arquivos,
            ler_arquivo,
            abrir,
            abrir_aqui,
            abrir_no_navegador,
            revelar,
            abrir_pasta_dos_resultados,
            motor_executar,
            motor_cancelar,
            motor_pasta_temporaria,
            motor_gravar_entrada,
            motor_vincular_entrada,
            motor_ler_saida,
            motor_entregar,
            motor_limpar,
            listar_impressoras,
            preferencias_da_impressora,
            impressao_preparar,
            impressao_pagina,
            impressao_enviar,
            impressao_descartar,
            uso_registrar,
            uso_ler,
            uso_zerar,
            integracao_consultar,
            integracao_definir,
            inicio_consultar,
            inicio_definir,
        ])
        .build(tauri::generate_context!())
        .expect("o aplicativo nao conseguiu iniciar")
        .run(|app, evento| {
            if let tauri::RunEvent::ExitRequested { .. } = evento {
                app.state::<Sessoes>().limpar_tudo();
            }
        });
}
