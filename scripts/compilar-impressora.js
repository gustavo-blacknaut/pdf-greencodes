/**
 * Compila o programa de impressao com o csc.exe que ja vem no Windows.
 *
 * Nao ha SDK do .NET para instalar: o compilador do .NET Framework 4 esta em
 * toda maquina com Windows 10 ou 11, e o executavel que ele gera roda nessas
 * maquinas sem runtime junto.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CSC = path.join(process.env.WINDIR || 'C:\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const PASTA = path.join(__dirname, '..', 'impressora');
const SAIDA = path.join(PASTA, 'impressora.exe');

if (!fs.existsSync(CSC)) {
  console.error('Nao achei o compilador do .NET Framework em:\n  ' + CSC);
  console.error('Ele vem com o Windows. Se sumiu, instale o .NET Framework 4.8.');
  process.exit(1);
}

const fontes = fs.readdirSync(PASTA).filter((nome) => nome.endsWith('.cs')).sort();
if (fontes.length === 0) {
  console.error('Nenhum arquivo .cs em ' + PASTA);
  process.exit(1);
}

try {
  execFileSync(
    CSC,
    ['-nologo', '-optimize+', '-platform:x64', '-target:exe', '-out:' + SAIDA, '-r:System.Drawing.dll', ...fontes],
    { cwd: PASTA, stdio: 'inherit' },
  );
} catch {
  process.exit(1);
}

const tamanho = fs.statSync(SAIDA).size;
console.log(`impressora.exe gerado — ${(tamanho / 1024).toFixed(1)} KB, ${fontes.length} arquivos`);
