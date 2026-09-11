// Mandar as paginas para a impressora.
//
// Recebe imagens ja prontas, uma por folha, que a interface montou a partir do
// PDF. A divisao e de proposito: o pdf.js desenha a arte e faz a montagem de
// grafica - escala, deslocamento, espelho, marcas de corte -, e o Windows
// imprime melhor que qualquer coisa disponivel la.
//
// Como cada imagem ja chega com a proporcao exata da folha escolhida, o
// encaixe aqui vira um mapeamento um por um. Foi a discordancia entre o
// tamanho que o desenho assumia e o tamanho que o driver recebia que fazia a
// arte sair do tamanho de uma A5 no meio de uma folha A4.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Printing;
using System.IO;

/// Tudo que o aplicativo controla na propria tela.
class Pedido
{
    public string Impressora;
    public List<string> Imagens = new List<string>();
    public string Devmode;
    public int Copias = 1;
    public string Titulo;
    public bool Ajustar = true;
    public string Arquivo;

    /// Identificador do papel no driver. 9 = A4, 11 = A5. Zero nao mexe.
    public int Papel;

    /// 1 colorido, 0 preto e branco, -1 deixa como o driver ja esta.
    public int Cor = -1;

    /// "simplex", "horizontal" ou "vertical". Vazio nao mexe.
    public string Duplex;

    public bool Paisagem;
}

static class Trabalho
{
    /// Imprime a lista de imagens, uma por folha.
    ///
    /// `Devmode` carrega tudo que o usuario escolheu na janela do driver, e o
    /// que vem depois dele so sobrescreve o que o aplicativo controla na sua
    /// propria tela.
    public static string Imprimir(Pedido pedido)
    {
        if (pedido.Imagens.Count == 0) throw new ArgumentException("nenhuma pagina para imprimir");

        foreach (string caminho in pedido.Imagens)
        {
            if (!File.Exists(caminho)) throw new FileNotFoundException("nao achei a pagina " + caminho);
        }

        var documento = new PrintDocument();
        documento.PrinterSettings.PrinterName = pedido.Impressora;

        if (!documento.PrinterSettings.IsValid)
        {
            throw new InvalidOperationException("impressora nao encontrada: " + pedido.Impressora);
        }

        Modo.Aplicar(documento.PrinterSettings, pedido.Devmode);

        AplicarPapel(documento, pedido.Papel);
        documento.DefaultPageSettings.Landscape = pedido.Paisagem;
        AplicarCor(documento, pedido.Cor);
        AplicarDuplex(documento, pedido.Duplex);

        if (pedido.Copias > 0)
        {
            documento.PrinterSettings.Copies = (short)Math.Min(pedido.Copias, (int)short.MaxValue);
        }
        documento.DocumentName = string.IsNullOrEmpty(pedido.Titulo) ? "PDF.GreenCodes" : pedido.Titulo;

        // Sem isso o Windows reserva a margem que o driver sugere e a pagina
        // sai reduzida. A interface ja montou a folha no tamanho certo, com a
        // margem por dentro dela.
        documento.OriginAtMargins = false;

        // Impressora virtual (Print to PDF, XPS) abre uma janela pedindo o
        // nome do arquivo. Dizer o destino aqui evita essa janela, e de
        // quebra da o "imprimir para arquivo" de graca.
        if (!string.IsNullOrEmpty(pedido.Arquivo))
        {
            documento.PrinterSettings.PrintToFile = true;
            documento.PrinterSettings.PrintFileName = pedido.Arquivo;
        }

        int proxima = 0;
        documento.PrintPage += (remetente, evento) =>
        {
            using (var imagem = Image.FromFile(pedido.Imagens[proxima]))
            {
                evento.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                evento.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                evento.Graphics.DrawImage(imagem, Encaixar(imagem, evento.PageBounds, pedido.Ajustar));
            }

            proxima++;
            evento.HasMorePages = proxima < pedido.Imagens.Count;
        };

        documento.Print();

        PaperSize folha = documento.DefaultPageSettings.PaperSize;
        return Json.Objeto(
            Json.Campo("ok", Json.Booleano(true)),
            Json.Campo("impressora", Json.Texto(pedido.Impressora)),
            Json.Campo("paginas", Json.Numero(pedido.Imagens.Count)),
            Json.Campo("copias", Json.Numero(documento.PrinterSettings.Copies)),
            Json.Campo("papel", Json.Texto(folha == null ? "" : folha.PaperName)),
            Json.Campo("larguraEmCentesimos", Json.Numero(folha == null ? 0 : folha.Width)),
            Json.Campo("alturaEmCentesimos", Json.Numero(folha == null ? 0 : folha.Height)),
            Json.Campo("paisagem", Json.Booleano(documento.DefaultPageSettings.Landscape)),
            Json.Campo("trabalho", Json.Texto(documento.DocumentName)),
            Json.Campo("arquivo", Json.Texto(pedido.Arquivo == null ? "" : pedido.Arquivo)));
    }

    /// Troca o tamanho do papel pelo que a tela pediu.
    ///
    /// Sem isto, o papel vem do que estava salvo no DEVMODE do driver. Uma
    /// impressora deixada em A5 recebia a folha A4 desenhada aqui, montava a
    /// pagina no tamanho A5 e a arte saia com metade da area, centralizada -
    /// que foi como o defeito chegou, numa fatura impressa.
    static void AplicarPapel(PrintDocument documento, int papel)
    {
        if (papel <= 0) return;

        foreach (PaperSize tamanho in documento.PrinterSettings.PaperSizes)
        {
            if ((int)tamanho.RawKind == papel)
            {
                documento.DefaultPageSettings.PaperSize = tamanho;
                return;
            }
        }

        // Papel que o driver nao lista ainda vale como tamanho pedido: o
        // Windows aceita um PaperSize com a medida em centesimos de polegada,
        // e a alternativa seria imprimir calado no tamanho errado.
        foreach (Medida medida in Papeis.Conhecidos)
        {
            if (medida.Codigo != papel) continue;
            PaperSize personalizado = new PaperSize(medida.Nome, medida.Largura, medida.Altura);
            personalizado.RawKind = papel;
            documento.DefaultPageSettings.PaperSize = personalizado;
            return;
        }
    }

    static void AplicarCor(PrintDocument documento, int cor)
    {
        if (cor < 0) return;
        // Impressora sem cor nao vira colorida por pedido nosso.
        if (cor == 1 && !documento.PrinterSettings.SupportsColor) return;
        documento.DefaultPageSettings.Color = cor == 1;
    }

    static void AplicarDuplex(PrintDocument documento, string duplex)
    {
        if (string.IsNullOrEmpty(duplex)) return;
        if (!documento.PrinterSettings.CanDuplex) return;

        switch (duplex)
        {
            case "simplex":
                documento.PrinterSettings.Duplex = Duplex.Simplex;
                break;
            // Virar pela borda curta e o que o Windows chama de Horizontal.
            case "horizontal":
            case "shortEdge":
                documento.PrinterSettings.Duplex = Duplex.Horizontal;
                break;
            case "vertical":
            case "longEdge":
                documento.PrinterSettings.Duplex = Duplex.Vertical;
                break;
        }
    }

    /// Onde a imagem entra na folha.
    ///
    /// Ajustando, a folha cabe inteira e sobra margem branca no lado mais
    /// curto; sem ajustar, ela ocupa tudo e o que passar e cortado. Quando a
    /// imagem ja chega na proporcao do papel os dois dao no mesmo, e e esse o
    /// caminho normal.
    static Rectangle Encaixar(Image imagem, Rectangle folha, bool ajustar)
    {
        double escalaLargura = (double)folha.Width / imagem.Width;
        double escalaAltura = (double)folha.Height / imagem.Height;
        double escala = ajustar ? Math.Min(escalaLargura, escalaAltura) : Math.Max(escalaLargura, escalaAltura);

        int largura = (int)Math.Round(imagem.Width * escala);
        int altura = (int)Math.Round(imagem.Height * escala);

        return new Rectangle(
            folha.X + (folha.Width - largura) / 2,
            folha.Y + (folha.Height - altura) / 2,
            largura,
            altura);
    }
}

/// Um papel da tela, medido em centesimos de polegada, sempre em pe.
class Medida
{
    public int Codigo;
    public string Nome;
    public int Largura;
    public int Altura;

    public Medida(int codigo, string nome, int largura, int altura)
    {
        Codigo = codigo;
        Nome = nome;
        Largura = largura;
        Altura = altura;
    }
}

/// Serve so para o caso raro do driver nao listar o tamanho pedido: e melhor
/// mandar a medida certa como papel personalizado do que imprimir calado no
/// tamanho que estava sobrando no driver.
static class Papeis
{
    public static readonly Medida[] Conhecidos = new Medida[]
    {
        new Medida(8, "A3", 1169, 1654),
        new Medida(9, "A4", 827, 1169),
        new Medida(11, "A5", 583, 827),
        new Medida(5, "Legal", 850, 1400),
        new Medida(1, "Letter", 850, 1100),
        new Medida(3, "Tabloid", 1100, 1700),
    };
}
