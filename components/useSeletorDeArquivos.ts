'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  aoLerArquivo,
  escolherArquivos,
  estaNoAplicativo,
  lerArquivoEscolhido,
  type ArquivoEscolhido,
} from '@/lib/desktop';

/**
 * Escolher arquivos, do mesmo jeito em qualquer lugar da tela.
 *
 * Isto morava dentro do `Dropzone`. Quando o organizar ganhou o botão de
 * juntar mais PDFs à grade, ele precisou do mesmo caminho — e o `Dropzone`
 * nem está montado nessa hora, porque a grade tomou o lugar dele.
 *
 * Copiar as vinte linhas para o outro lado era o começo de duas versões que
 * envelhecem separadas: uma lendo um arquivo por vez, a outra em paralelo;
 * uma avisando o progresso, a outra não. O gancho existe para isso não
 * acontecer.
 *
 * No aplicativo o diálogo é o do Windows, que lembra a última pasta e mostra
 * os locais do sistema. O seletor do navegador não faz nem um nem outro, e é
 * o que sobra no site.
 */
export function useSeletorDeArquivos({
  accept,
  multiple,
  onFiles,
  onEscolhidos,
  onLendo,
  onFalha,
}: {
  accept: string[];
  multiple: boolean;
  onFiles: (arquivos: File[]) => void;
  /** Os nomes aparecem na tela antes da leitura começar. */
  onEscolhidos?: (escolhidos: ArquivoEscolhido[]) => void;
  onLendo?: (nome: string, lidos: number, total: number) => void;
  onFalha?: (nomes: string[], erro: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [noApp, setNoApp] = useState(false);

  useEffect(() => setNoApp(estaNoAplicativo()), []);

  /**
   * O que vem com caminho — do diálogo ou arrastado para a janela — segue
   * sempre por aqui: mostra na hora, lê em seguida, e o PDF grande fica no
   * disco em vez de entrar na memória.
   */
  const receber = useCallback(
    async (recebidos: ArquivoEscolhido[]) => {
      const extensoes = accept.filter((tipo) => tipo.startsWith('.'));
      const aceitos = recebidos.filter((e) => extensoes.some((ext) => e.nome.toLowerCase().endsWith(ext)));
      if (!aceitos.length) {
        onFalha?.([], `Esta ferramenta não abre ${recebidos.length === 1 ? 'este formato' : 'estes formatos'}.`);
        return;
      }
      const lista = multiple ? aceitos : aceitos.slice(0, 1);
      await lerEscolhidos(lista);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accept, multiple, onEscolhidos, onFalha, onFiles, onLendo],
  );

  const abrir = useCallback(async () => {
    if (!noApp) {
      inputRef.current?.click();
      return;
    }

    const escolhidos = await escolherArquivos(accept.filter((tipo) => tipo.startsWith('.')));
    if (!escolhidos.length) return;
    await lerEscolhidos(multiple ? escolhidos : escolhidos.slice(0, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accept, multiple, noApp, onEscolhidos, onFalha, onFiles, onLendo]);

  async function lerEscolhidos(lista: ArquivoEscolhido[]) {
    onEscolhidos?.(lista);

    const cancelar = onLendo
      ? aoLerArquivo(({ caminho, lidos, total }) => {
          const alvo = lista.find((e) => e.caminho === caminho);
          if (alvo) onLendo(alvo.nome, lidos, total);
        })
      : () => {};

    try {
      const arquivos: File[] = [];
      // Um de cada vez: dois arquivos de 400 MB lidos juntos dobram a memória
      // sem adiantar nada, porque o disco é o mesmo.
      for (const escolhido of lista) {
        arquivos.push(await lerArquivoEscolhido(escolhido));
      }
      onFiles(arquivos);
    } catch (erro) {
      // Sem isto o marcador na tela ficaria em "carregando" para sempre.
      onFalha?.(
        lista.map((e) => e.nome),
        erro instanceof Error ? erro.message : 'Não foi possível ler o arquivo.',
      );
    } finally {
      cancelar();
    }
  }

  /** O que o consumidor precisa pôr num `<input type="file">` escondido. */
  const inputProps = {
    ref: inputRef,
    type: 'file' as const,
    className: 'sr-only',
    accept: accept.join(','),
    multiple,
    onChange: (evento: React.ChangeEvent<HTMLInputElement>) => {
      const arquivos = [...(evento.target.files ?? [])];
      if (arquivos.length) onFiles(arquivos);
      evento.target.value = '';
    },
  };

  return { abrir, receber, inputProps, noApp };
}
