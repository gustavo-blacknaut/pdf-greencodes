// Escritor de JSON minimo.
//
// O programa so precisa escrever, nunca ler, e o formato e sempre gerado por
// aqui. Uma biblioteca externa custaria um DLL junto do executavel para
// resolver um problema de trinta linhas.

using System.Collections.Generic;
using System.Globalization;
using System.Text;

static class Json
{
    public static string Texto(string valor)
    {
        if (valor == null) return "null";

        var saida = new StringBuilder("\"");
        foreach (char c in valor)
        {
            if (c == '"') saida.Append("\\\"");
            else if (c == '\\') saida.Append("\\\\");
            else if (c == '\n') saida.Append("\\n");
            else if (c == '\r') saida.Append("\\r");
            else if (c == '\t') saida.Append("\\t");
            else if (c < ' ') saida.Append("\\u").Append(((int)c).ToString("x4"));
            else saida.Append(c);
        }
        return saida.Append('"').ToString();
    }

    public static string Numero(int valor)
    {
        return valor.ToString(CultureInfo.InvariantCulture);
    }

    public static string Booleano(bool valor)
    {
        return valor ? "true" : "false";
    }

    public static string Objeto(params string[] campos)
    {
        return "{" + string.Join(",", campos) + "}";
    }

    public static string Campo(string nome, string valorJaEmJson)
    {
        return Texto(nome) + ":" + valorJaEmJson;
    }

    public static string Lista(IEnumerable<string> itensJaEmJson)
    {
        return "[" + string.Join(",", new List<string>(itensJaEmJson).ToArray()) + "]";
    }
}
