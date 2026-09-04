// O que cada impressora aceita, perguntado direto ao driver.
//
// DeviceCapabilities e o unico caminho ate a lista de tipos de papel do
// fabricante ("Comum", "Grosso", "Etiqueta", "Fotografico"), que e o que o
// navegador nao mostra e que numa grafica decide o trabalho.

using System;
using System.Collections.Generic;
using System.Drawing.Printing;
using System.Runtime.InteropServices;

static class Dispositivo
{
    // Indices de DeviceCapabilities. Os numeros sao fixos desde o Windows 95 e
    // nao existe constante gerenciada equivalente.
    const int DC_PAPERS = 2;
    const int DC_PAPERNAMES = 16;
    const int DC_BINS = 6;
    const int DC_BINNAMES = 12;
    const int DC_COPIES = 18;
    const int DC_DUPLEX = 7;
    const int DC_COLORDEVICE = 32;
    const int DC_MEDIATYPES = 35;
    const int DC_MEDIATYPENAMES = 34;

    // Tamanho fixo de cada nome nos vetores de texto que o driver devolve.
    const int LETRAS_PAPEL = 64;
    const int LETRAS_BANDEJA = 24;
    const int LETRAS_TIPO = 64;

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern int DeviceCapabilities(string dispositivo, string porta, int recurso, IntPtr saida, IntPtr devmode);

    /// Todas as impressoras instaladas, cada uma com o que o driver aceita.
    public static string Listar()
    {
        string padrao = "";
        try { padrao = new PrinterSettings().PrinterName; }
        catch { }

        var lista = new List<string>();
        foreach (string nome in PrinterSettings.InstalledPrinters)
        {
            lista.Add(Descrever(nome, nome == padrao));
        }
        return Json.Objeto(Json.Campo("impressoras", Json.Lista(lista)));
    }

    static string Descrever(string nome, bool padrao)
    {
        var campos = new List<string>
        {
            Json.Campo("nome", Json.Texto(nome)),
            Json.Campo("padrao", Json.Booleano(padrao)),
        };

        // Impressora desligada ou com driver quebrado faz DeviceCapabilities
        // devolver -1. Nesse caso a entrada sai so com o nome, em vez de
        // derrubar a listagem inteira.
        try
        {
            campos.Add(Json.Campo("cor", Json.Booleano(Numero(nome, DC_COLORDEVICE) == 1)));
            campos.Add(Json.Campo("duplex", Json.Booleano(Numero(nome, DC_DUPLEX) == 1)));

            int copias = Numero(nome, DC_COPIES);
            campos.Add(Json.Campo("copiasMax", Json.Numero(copias > 0 ? copias : 1)));

            campos.Add(Json.Campo("papeis", Pares(nome, DC_PAPERNAMES, LETRAS_PAPEL, DC_PAPERS)));
            campos.Add(Json.Campo("bandejas", Pares(nome, DC_BINNAMES, LETRAS_BANDEJA, DC_BINS)));
            campos.Add(Json.Campo("tipos", Pares(nome, DC_MEDIATYPENAMES, LETRAS_TIPO, DC_MEDIATYPES)));
        }
        catch (Exception erro)
        {
            campos.Add(Json.Campo("erro", Json.Texto(erro.Message)));
        }

        return Json.Objeto(campos.ToArray());
    }

    static int Numero(string impressora, int recurso)
    {
        return DeviceCapabilities(impressora, null, recurso, IntPtr.Zero, IntPtr.Zero);
    }

    /// Casa o vetor de nomes com o vetor de identificadores.
    ///
    /// O driver devolve os dois separados e na mesma ordem: DC_MEDIATYPENAMES
    /// da "Comum", "Grosso", "Etiqueta"; DC_MEDIATYPES da o numero que precisa
    /// ir no DEVMODE para escolher cada um.
    static string Pares(string impressora, int recursoNomes, int letras, int recursoIds)
    {
        string[] nomes = Textos(impressora, recursoNomes, letras);
        int[] ids = Inteiros(impressora, recursoIds);
        var itens = new List<string>();

        for (int i = 0; i < nomes.Length; i++)
        {
            itens.Add(Json.Objeto(
                Json.Campo("id", Json.Numero(i < ids.Length ? ids[i] : 0)),
                Json.Campo("nome", Json.Texto(nomes[i]))));
        }
        return Json.Lista(itens);
    }

    static string[] Textos(string impressora, int recurso, int letras)
    {
        int quantos = Numero(impressora, recurso);
        if (quantos <= 0) return new string[0];

        IntPtr area = Marshal.AllocHGlobal(quantos * letras * sizeof(char));
        try
        {
            if (DeviceCapabilities(impressora, null, recurso, area, IntPtr.Zero) <= 0) return new string[0];

            var saida = new List<string>();
            for (int i = 0; i < quantos; i++)
            {
                // Cada nome ocupa uma fatia de tamanho fixo, preenchida com
                // zeros ate o fim. O corte no primeiro zero separa o nome do
                // enchimento.
                string bruto = Marshal.PtrToStringUni(new IntPtr(area.ToInt64() + i * letras * sizeof(char)), letras);
                int fim = bruto.IndexOf('\0');
                saida.Add((fim >= 0 ? bruto.Substring(0, fim) : bruto).Trim());
            }
            return saida.ToArray();
        }
        finally { Marshal.FreeHGlobal(area); }
    }

    static int[] Inteiros(string impressora, int recurso)
    {
        int quantos = Numero(impressora, recurso);
        if (quantos <= 0) return new int[0];

        // DC_PAPERS e DC_BINS devolvem WORD; DC_MEDIATYPES devolve DWORD.
        bool largo = recurso == DC_MEDIATYPES;
        int tamanho = largo ? 4 : 2;

        IntPtr area = Marshal.AllocHGlobal(quantos * tamanho);
        try
        {
            if (DeviceCapabilities(impressora, null, recurso, area, IntPtr.Zero) <= 0) return new int[0];

            var saida = new int[quantos];
            for (int i = 0; i < quantos; i++)
            {
                saida[i] = largo
                    ? Marshal.ReadInt32(area, i * 4)
                    : (int)(ushort)Marshal.ReadInt16(area, i * 2);
            }
            return saida;
        }
        finally { Marshal.FreeHGlobal(area); }
    }
}
