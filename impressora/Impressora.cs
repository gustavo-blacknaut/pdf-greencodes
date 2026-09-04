// Controle da impressora pelo Windows.
//
// Existe porque o Chromium nao expoe o DEVMODE do driver: pelo navegador da
// para escolher impressora, copias e margem, e acaba ai. Tipo e espessura do
// papel, bandeja, qualidade e duplex moram no driver do fabricante, e o
// caminho ate eles e a API de impressao do Windows.
//
// Compila com o csc.exe que ja vem no Windows. Sem SDK e sem runtime junto: o
// .NET Framework 4.8 esta em toda maquina com Windows 10 ou 11.
//
// Comandos:
//   impressora.exe listar
//   impressora.exe atual      --impressora "HP LaserJet"
//   impressora.exe configurar --impressora "HP LaserJet" [--modo <base64>]
//   impressora.exe imprimir   --impressora "HP LaserJet" --paginas lista.txt
//                             [--modo <base64>] [--copias 2] [--titulo "x"] [--preencher]
//                             [--arquivo saida.pdf]

using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

static class Impressora
{
    static int Main(string[] argumentos)
    {
        try
        {
            Console.OutputEncoding = new UTF8Encoding(false);

            string comando = argumentos.Length > 0 ? argumentos[0] : "listar";
            var opcoes = LerOpcoes(argumentos);

            switch (comando)
            {
                case "listar":
                    Console.Out.Write(Dispositivo.Listar());
                    return 0;

                case "atual":
                    Console.Out.Write(Configuracao(Modo.Atual(Exigir(opcoes, "impressora"))));
                    return 0;

                case "configurar":
                {
                    // Sem dono, o Windows impede este processo recem-aberto
                    // de roubar o foco de quem esta em primeiro plano: a
                    // janela nasceria atras do Electron. --janela traz o
                    // HWND do aplicativo, e a janela do driver nasce como
                    // filha dele, na frente.
                    string janela = Ler(opcoes, "janela");
                    IntPtr dono = string.IsNullOrEmpty(janela) ? IntPtr.Zero : new IntPtr(long.Parse(janela, System.Globalization.NumberStyles.HexNumber));
                    string escolhido = Modo.Perguntar(Exigir(opcoes, "impressora"), Ler(opcoes, "modo"), dono);
                    Console.Out.Write(escolhido == null
                        ? Json.Objeto(Json.Campo("cancelado", Json.Booleano(true)))
                        : Configuracao(escolhido));
                    return 0;
                }

                case "imprimir":
                {
                    string lista = Exigir(opcoes, "paginas");
                    if (!File.Exists(lista)) throw new FileNotFoundException("nao achei a lista de paginas: " + lista);

                    var imagens = new List<string>();
                    foreach (string linha in File.ReadAllLines(lista, Encoding.UTF8))
                    {
                        string caminho = linha.Trim();
                        if (caminho.Length > 0) imagens.Add(caminho);
                    }

                    int copias;
                    if (!int.TryParse(Ler(opcoes, "copias"), out copias)) copias = 1;

                    Console.Out.Write(Trabalho.Imprimir(
                        Exigir(opcoes, "impressora"),
                        imagens,
                        Ler(opcoes, "modo"),
                        copias,
                        Ler(opcoes, "titulo"),
                        !opcoes.ContainsKey("preencher"),
                        Ler(opcoes, "arquivo")));
                    return 0;
                }

                default:
                    Console.Error.Write("comando desconhecido: " + comando);
                    return 2;
            }
        }
        catch (Exception erro)
        {
            // Uma linha de JSON no stderr, para o aplicativo mostrar o motivo
            // em vez de "falhou".
            Console.Error.Write(Json.Objeto(
                Json.Campo("erro", Json.Texto(erro.Message)),
                Json.Campo("classe", Json.Texto(erro.GetType().Name))));
            return 1;
        }
    }

    static string Configuracao(string base64)
    {
        return Json.Objeto(
            Json.Campo("cancelado", Json.Booleano(false)),
            Json.Campo("modo", Json.Texto(base64)));
    }

    /// Le "--chave valor" e "--chave" solto, que vale como marcador ligado.
    static Dictionary<string, string> LerOpcoes(string[] argumentos)
    {
        var opcoes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        for (int i = 1; i < argumentos.Length; i++)
        {
            if (!argumentos[i].StartsWith("--")) continue;

            string chave = argumentos[i].Substring(2);
            bool temValor = i + 1 < argumentos.Length && !argumentos[i + 1].StartsWith("--");
            opcoes[chave] = temValor ? argumentos[++i] : "";
        }
        return opcoes;
    }

    static string Ler(Dictionary<string, string> opcoes, string chave)
    {
        string valor;
        return opcoes.TryGetValue(chave, out valor) ? valor : "";
    }

    static string Exigir(Dictionary<string, string> opcoes, string chave)
    {
        string valor = Ler(opcoes, chave);
        if (string.IsNullOrEmpty(valor)) throw new ArgumentException("faltou --" + chave);
        return valor;
    }
}
