// O DEVMODE: a estrutura em que o driver guarda a escolha do usuario.
//
// Este e o pedaco que o Chromium nao entrega. Tipo e espessura do papel,
// bandeja, qualidade, duplex e tudo que so existe no driver do fabricante
// moram aqui dentro, num bloco de bytes que so o proprio driver sabe ler por
// inteiro.
//
// O aplicativo nunca interpreta esse bloco. Ele recebe em base64, guarda, e
// devolve na hora de imprimir. Tentar remontar o DEVMODE campo a campo daria
// errado no primeiro driver que guarda algo fora do padrao, e todos guardam.

using System;
using System.Drawing.Printing;
using System.Runtime.InteropServices;

static class Modo
{
    const int DM_OUT_BUFFER = 2;
    const int DM_IN_PROMPT = 4;
    const int DM_IN_BUFFER = 8;

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool OpenPrinter(string nome, out IntPtr identificador, IntPtr padroes);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr identificador);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern int DocumentProperties(IntPtr janela, IntPtr impressora, string dispositivo, IntPtr saida, IntPtr entrada, int modo);

    /// Abre a janela do driver e devolve a escolha do usuario em base64.
    ///
    /// `anterior` em base64 faz a janela abrir ja com a ultima escolha
    /// marcada, em vez de voltar ao padrao de fabrica toda vez.
    ///
    /// Devolve null se o usuario cancelar.
    public static string Perguntar(string impressora, string anterior, IntPtr janela)
    {
        return Trabalhar(impressora, anterior, DM_IN_BUFFER | DM_IN_PROMPT | DM_OUT_BUFFER, janela);
    }

    /// A configuracao atual da impressora, sem abrir janela nenhuma.
    public static string Atual(string impressora)
    {
        return Trabalhar(impressora, null, DM_OUT_BUFFER, IntPtr.Zero);
    }

    static string Trabalhar(string impressora, string anterior, int modo, IntPtr janela)
    {
        IntPtr identificador;
        if (!OpenPrinter(impressora, out identificador, IntPtr.Zero))
        {
            throw new InvalidOperationException("nao consegui abrir a impressora " + impressora + " (erro " + Marshal.GetLastWin32Error() + ")");
        }

        IntPtr entrada = IntPtr.Zero;
        IntPtr saida = IntPtr.Zero;
        try
        {
            // Chamada com ponteiros zerados: o driver responde de quantos
            // bytes precisa. O tamanho varia por fabricante, entao perguntar e
            // a unica forma correta de reservar.
            int tamanho = DocumentProperties(IntPtr.Zero, identificador, impressora, IntPtr.Zero, IntPtr.Zero, 0);
            if (tamanho <= 0)
            {
                throw new InvalidOperationException("o driver de " + impressora + " nao informou o tamanho das configuracoes");
            }

            byte[] bytesAnteriores = null;
            if (!string.IsNullOrEmpty(anterior))
            {
                try { bytesAnteriores = Convert.FromBase64String(anterior); }
                catch (FormatException) { bytesAnteriores = null; }
            }

            // Configuracao salva de outra impressora tem outro tamanho e o
            // driver rejeitaria. Descartar e voltar ao padrao e melhor que
            // falhar na frente do usuario.
            if (bytesAnteriores != null && bytesAnteriores.Length >= tamanho)
            {
                entrada = Marshal.AllocHGlobal(bytesAnteriores.Length);
                Marshal.Copy(bytesAnteriores, 0, entrada, bytesAnteriores.Length);
            }
            else
            {
                modo &= ~DM_IN_BUFFER;
            }

            saida = Marshal.AllocHGlobal(tamanho);
            int resposta = DocumentProperties(janela, identificador, impressora, saida, entrada, modo);

            // IDCANCEL: o usuario fechou a janela sem confirmar.
            if (resposta != 1) return null;

            byte[] escolhido = new byte[tamanho];
            Marshal.Copy(saida, escolhido, 0, tamanho);
            return Convert.ToBase64String(escolhido);
        }
        finally
        {
            if (entrada != IntPtr.Zero) Marshal.FreeHGlobal(entrada);
            if (saida != IntPtr.Zero) Marshal.FreeHGlobal(saida);
            ClosePrinter(identificador);
        }
    }

    /// Aplica um DEVMODE guardado sobre as configuracoes de um trabalho.
    public static void Aplicar(PrinterSettings ajustes, string base64)
    {
        if (string.IsNullOrEmpty(base64)) return;

        byte[] bytes;
        try { bytes = Convert.FromBase64String(base64); }
        catch (FormatException) { return; }

        IntPtr area = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, area, bytes.Length);
            ajustes.SetHdevmode(area);
        }
        finally { Marshal.FreeHGlobal(area); }
    }
}
