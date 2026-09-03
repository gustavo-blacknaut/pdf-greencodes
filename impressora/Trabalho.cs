// Mandar as paginas para a impressora.
//
// Recebe imagens ja prontas, uma por pagina, que o motor Python desenhou a
// partir do PDF. A divisao e de proposito: o MuPDF desenha melhor e mais
// rapido que qualquer coisa disponivel aqui, e o Windows imprime melhor que
// qualquer coisa disponivel la.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Printing;
using System.IO;

static class Trabalho
{
    /// Imprime a lista de imagens, uma por pagina.
    ///
    /// `devmode` carrega tudo que o usuario escolheu na janela do driver, e o
    /// que vem depois dele (copias, intervalo) so sobrescreve o que o
    /// aplicativo controla na sua propria tela.
    public static string Imprimir(string impressora, List<string> imagens, string devmode, int copias, string titulo, bool ajustar, string arquivo)
    {
        if (imagens.Count == 0) throw new ArgumentException("nenhuma pagina para imprimir");

        foreach (string caminho in imagens)
        {
            if (!File.Exists(caminho)) throw new FileNotFoundException("nao achei a pagina " + caminho);
        }

        var documento = new PrintDocument();
        documento.PrinterSettings.PrinterName = impressora;

        if (!documento.PrinterSettings.IsValid)
        {
            throw new InvalidOperationException("impressora nao encontrada: " + impressora);
        }

        Modo.Aplicar(documento.PrinterSettings, devmode);

        if (copias > 0) documento.PrinterSettings.Copies = (short)Math.Min(copias, (int)short.MaxValue);
        documento.DocumentName = string.IsNullOrEmpty(titulo) ? "PDF.GreenCodes" : titulo;

        // Sem isso o Windows reserva a margem que o driver sugere e a pagina
        // sai reduzida. O motor ja desenhou a pagina no tamanho certo,
        // margem inclusa.
        documento.OriginAtMargins = false;

        // Impressora virtual (Print to PDF, XPS) abre uma janela pedindo o
        // nome do arquivo. Dizer o destino aqui evita essa janela, e de
        // quebra da o "imprimir para arquivo" de graca.
        if (!string.IsNullOrEmpty(arquivo))
        {
            documento.PrinterSettings.PrintToFile = true;
            documento.PrinterSettings.PrintFileName = arquivo;
        }

        int proxima = 0;
        documento.PrintPage += (remetente, evento) =>
        {
            using (var imagem = Image.FromFile(imagens[proxima]))
            {
                evento.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                evento.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                evento.Graphics.DrawImage(imagem, Encaixar(imagem, evento.PageBounds, ajustar));
            }

            proxima++;
            evento.HasMorePages = proxima < imagens.Count;
        };

        documento.Print();
        return Json.Objeto(
            Json.Campo("impressora", Json.Texto(impressora)),
            Json.Campo("paginas", Json.Numero(imagens.Count)),
            Json.Campo("copias", Json.Numero(documento.PrinterSettings.Copies)),
            Json.Campo("trabalho", Json.Texto(documento.DocumentName)),
            Json.Campo("arquivo", Json.Texto(arquivo ?? "")));
    }

    /// Onde a imagem entra na folha.
    ///
    /// Ajustando, a pagina cabe inteira e sobra margem branca no lado mais
    /// curto; sem ajustar, ela ocupa a folha toda e o que passar e cortado.
    /// A escolha e do usuario porque as duas estao certas: contrato nao pode
    /// perder rodape, foto 10x15 nao pode ter tarja branca.
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
