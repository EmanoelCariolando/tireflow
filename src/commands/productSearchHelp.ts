function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length]!;
}

function resembles(token: string | undefined, expected: string): boolean {
  return Boolean(token && token.length >= 4 && editDistance(token, expected) <= 2);
}

export function formatSimilarProductSearchHelp(body: string): string | null {
  const normalized = normalize(body).replace(/^0\s+/, '');
  const tokens = normalized.split(' ');
  const first = tokens[0];

  if (resembles(first, 'bateria')) {
    return [
      '⚠️ *COMO PESQUISAR BATERIAS*',
      '',
      'Digite a amperagem. Exemplo: *bateria 50*',
      'Para ver as zeradas: *0 bateria 50*',
    ].join('\n');
  }

  if (resembles(first, 'camara')) {
    return [
      '⚠️ *COMO PESQUISAR CÂMARAS DE AR*',
      '',
      'Carros e máquinas: *camara*',
      'Motos: *camara mt*',
      'Para ver as zeradas: *0 camara* ou *0 camara mt*',
    ].join('\n');
  }

  const coveredToken = first === 'pneu' ? tokens[1] : first;
  if (resembles(coveredToken, 'coberto')) {
    return [
      '⚠️ *COMO PESQUISAR PNEUS COBERTOS*',
      '',
      'Carros e máquinas: *coberto*',
      'Motos: *coberto mt*',
      'Para ver os zerados: *0 coberto* ou *0 coberto mt*',
    ].join('\n');
  }

  return null;
}
