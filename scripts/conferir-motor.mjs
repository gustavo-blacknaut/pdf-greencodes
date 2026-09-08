/**
 * Confere se o motor tem todas as DLLs de que ele precisa.
 *
 * Este script existe por causa de um erro que passou por tudo. O motor abria
 * aqui, o teste passava, o instalador saía, e na máquina da loja o programa
 * respondia:
 *
 *     ImportError: DLL load failed while importing _extra:
 *     não foi possível encontrar o módulo especificado
 *
 * A causa: o `mupdfcpp64.dll` do PyMuPDF depende do `msvcp140.dll`, que é a
 * biblioteca padrão de C++ da Microsoft — e a distribuição embutida do Python
 * traz o `vcruntime140`, mas **não traz o `msvcp140`**. Numa máquina de
 * desenvolvimento ele existe no System32, porque qualquer coisa instalada
 * antes já trouxe o Visual C++ Redistributable junto. Num Windows recém
 * formatado, não existe — e o programa quebra exatamente onde não dá para
 * depurar.
 *
 * Nenhum teste de Python pega isso, porque o Python roda. Nenhum teste de
 * TypeScript pega, porque o motor responde. O que pega é olhar a tabela de
 * importação de cada binário e perguntar: essa DLL vai junto no instalador?
 *
 *   node scripts/conferir-motor.mjs
 *   node scripts/conferir-motor.mjs dist-app/win-unpacked/resources/recursos/motor
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * O que o Windows sempre tem, e portanto não precisa ir no instalador.
 *
 * As `api-ms-win-*` e `ext-ms-*` são os "conjuntos de API" — nomes virtuais
 * que o carregador resolve para as bibliotecas de verdade. Elas nunca
 * existem como arquivo, e procurá-las na pasta seria falso alarme garantido.
 */
const PREFIXOS_DO_SISTEMA = ['api-ms-win-', 'ext-ms-'];

const DO_SISTEMA = new Set(
  [
    'kernel32', 'kernelbase', 'ntdll', 'user32', 'gdi32', 'advapi32', 'shell32', 'shlwapi',
    'ole32', 'oleaut32', 'combase', 'rpcrt4', 'comdlg32', 'comctl32', 'uxtheme', 'dwmapi',
    'ws2_32', 'mswsock', 'iphlpapi', 'dnsapi', 'winhttp', 'wininet', 'wldap32', 'netapi32',
    'crypt32', 'bcrypt', 'ncrypt', 'cryptbase', 'secur32', 'wintrust',
    'msvcrt', 'ucrtbase', 'version', 'winmm', 'psapi', 'imm32', 'setupapi', 'cabinet',
    'normaliz', 'userenv', 'powrprof', 'mpr', 'dbghelp', 'winspool', 'oleacc',
    // Estas duas vêm do Windows e são pedidas por módulos da biblioteca
    // padrão do Python que o motor nem usa — `_msi` e `_wmi`.
    'msi', 'propsys',
  ].map((nome) => `${nome}.dll`),
);

const BINARIOS = /\.(dll|pyd|exe)$/i;

// --------------------------------------------------------- leitura do PE ---

/**
 * Lê a tabela de importação de um executável do Windows.
 *
 * O formato é o PE, e o caminho até a lista de DLLs é sempre o mesmo: o
 * cabeçalho DOS aponta para o cabeçalho PE, que aponta para os diretórios de
 * dados, dos quais o de índice 1 é o de importação. Os endereços lá dentro
 * são "virtuais" — de onde o arquivo estaria na memória — e precisam ser
 * traduzidos para posição no arquivo pela tabela de seções.
 */
export function dllsQueImporta(arquivo) {
  const bytes = readFileSync(arquivo);
  if (bytes.length < 0x40 || bytes.readUInt16LE(0) !== 0x5a4d) return []; // "MZ"

  const pe = bytes.readUInt32LE(0x3c);
  if (pe + 24 > bytes.length || bytes.readUInt32LE(pe) !== 0x00004550) return []; // "PE\0\0"

  const tamanhoDoOpcional = bytes.readUInt16LE(pe + 20);
  const opcional = pe + 24;
  const magico = bytes.readUInt16LE(opcional);
  // 0x20b é PE32+ (64 bits), e nele os diretórios começam 16 bytes depois.
  const diretorios = opcional + (magico === 0x20b ? 112 : 96);

  const secoes = [];
  const inicioDasSecoes = opcional + tamanhoDoOpcional;
  const quantasSecoes = bytes.readUInt16LE(pe + 6);
  for (let i = 0; i < quantasSecoes; i += 1) {
    const s = inicioDasSecoes + i * 40;
    if (s + 40 > bytes.length) break;
    secoes.push({
      virtual: bytes.readUInt32LE(s + 12),
      tamanhoVirtual: bytes.readUInt32LE(s + 8),
      bruto: bytes.readUInt32LE(s + 20),
      tamanhoBruto: bytes.readUInt32LE(s + 16),
    });
  }

  /** De endereço virtual para posição no arquivo. */
  const posicao = (rva) => {
    for (const s of secoes) {
      const tamanho = Math.max(s.tamanhoVirtual, s.tamanhoBruto);
      if (rva >= s.virtual && rva < s.virtual + tamanho) return rva - s.virtual + s.bruto;
    }
    return -1;
  };

  const texto = (rva) => {
    const inicio = posicao(rva);
    if (inicio < 0 || inicio >= bytes.length) return '';
    const fim = bytes.indexOf(0, inicio);
    return bytes.toString('latin1', inicio, fim < 0 ? bytes.length : fim);
  };

  const nomes = new Set();

  /** Percorre uma tabela de descritores até o registro todo zerado. */
  const percorrer = (rvaDaTabela, tamanhoDoRegistro, ondeFicaONome) => {
    let onde = posicao(rvaDaTabela);
    if (onde < 0) return;
    while (onde + tamanhoDoRegistro <= bytes.length) {
      const rvaDoNome = bytes.readUInt32LE(onde + ondeFicaONome);
      // Registro zerado marca o fim da lista.
      if (bytes.subarray(onde, onde + tamanhoDoRegistro).every((b) => b === 0)) break;
      const nome = texto(rvaDoNome);
      if (nome) nomes.add(nome.toLowerCase());
      onde += tamanhoDoRegistro;
    }
  };

  // Diretório 1: importação normal. Descritor de 20 bytes, nome no 12.
  const importacao = bytes.readUInt32LE(diretorios + 1 * 8);
  if (importacao) percorrer(importacao, 20, 12);

  // Diretório 13: importação adiada. Descritor de 32 bytes, nome no 4.
  const adiada = bytes.readUInt32LE(diretorios + 13 * 8);
  if (adiada) percorrer(adiada, 32, 4);

  return [...nomes];
}

// ----------------------------------------------------------- a varredura ---

function todosOsBinarios(pasta) {
  const achados = [];
  const visitar = (atual) => {
    for (const item of readdirSync(atual)) {
      const caminho = path.join(atual, item);
      if (statSync(caminho).isDirectory()) visitar(caminho);
      else if (BINARIOS.test(item)) achados.push(caminho);
    }
  };
  visitar(pasta);
  return achados;
}

function ehDoSistema(nome) {
  return PREFIXOS_DO_SISTEMA.some((p) => nome.startsWith(p)) || DO_SISTEMA.has(nome);
}

/**
 * Confere a pasta inteira.
 *
 * Devolve a lista de faltas: cada DLL que algum binário importa, não é do
 * Windows, e não está em lugar nenhum da pasta.
 */
export function conferir(pastaDoMotor) {
  const binarios = todosOsBinarios(pastaDoMotor);
  const presentes = new Set(binarios.map((c) => path.basename(c).toLowerCase()));

  const faltas = new Map();
  for (const binario of binarios) {
    for (const dependencia of dllsQueImporta(binario)) {
      if (ehDoSistema(dependencia) || presentes.has(dependencia)) continue;
      if (!faltas.has(dependencia)) faltas.set(dependencia, []);
      faltas.get(dependencia).push(path.relative(pastaDoMotor, binario));
    }
  }

  return { binarios: binarios.length, faltas };
}

// `pathToFileURL` e não montar a string à mão: no Windows o caminho começa
// com letra de unidade, e a URL fica com três barras em vez de duas — a
// comparação ingênua nunca casa, e o script sai sem fazer nada.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const alvo = path.resolve(RAIZ, process.argv[2] ?? path.join('motor', 'runtime'));
  console.log(`Conferindo ${path.relative(RAIZ, alvo) || alvo}`);

  const { binarios, faltas } = conferir(alvo);
  console.log(`   ${binarios} binários lidos`);

  if (!faltas.size) {
    console.log('   Nenhuma DLL faltando: o motor roda em Windows recém formatado.');
    process.exit(0);
  }

  console.error('\nFaltam DLLs no motor. Numa máquina sem o Visual C++ Redistributable,');
  console.error('o programa vai responder "DLL load failed" e nenhuma ferramenta do motor funciona.\n');
  for (const [dll, quem] of faltas) {
    console.error(`   ${dll}`);
    for (const binario of quem.slice(0, 4)) console.error(`      precisa dela: ${binario}`);
    if (quem.length > 4) console.error(`      e mais ${quem.length - 4}`);
  }
  console.error('\nRode: node scripts/preparar-motor.mjs --forcar');
  process.exit(1);
}
