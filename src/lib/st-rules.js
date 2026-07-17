export const ST_STATUS = {
  COM_ST: 'COM_ST',
  ST_INCLUSO: 'ST_INCLUSO',
  ST_SEPARADO: 'ST_SEPARADO',
  ST_ISENTO: 'ST_ISENTO',
  SEM_ST: 'SEM_ST',
  ST_DESCONHECIDO: 'ST_DESCONHECIDO'
};

export function isValidST(stStatus) {
  return (
    stStatus === ST_STATUS.COM_ST ||
    stStatus === ST_STATUS.ST_INCLUSO ||
    stStatus === ST_STATUS.ST_SEPARADO ||
    stStatus === ST_STATUS.ST_ISENTO
  );
}

export function getVisualStatusLabel(stStatus) {
  switch (stStatus) {
    case ST_STATUS.COM_ST:
    case ST_STATUS.ST_INCLUSO:
      return 'Válido com ST';
    case ST_STATUS.ST_SEPARADO:
      return 'ST separado — conferir custo final';
    case ST_STATUS.ST_ISENTO:
      return 'Valido - categoria isenta de ST';
    case ST_STATUS.SEM_ST:
      return 'Ignorado — sem ST';
    case ST_STATUS.ST_DESCONHECIDO:
      return 'Precisa revisar ST';
    default:
      return 'Precisa revisar ST';
  }
}

export function getSTPriority(stStatus) {
  // Prioritize COM_ST/ST_INCLUSO over ST_SEPARADO
  switch (stStatus) {
    case ST_STATUS.COM_ST:
    case ST_STATUS.ST_INCLUSO:
    case ST_STATUS.ST_ISENTO:
      return 1;
    case ST_STATUS.ST_SEPARADO:
      return 2;
    default:
      return 3;
  }
}
