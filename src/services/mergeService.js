// Prepara um MAP usando BARRAS como chave
function prepararMapaXLS(dadosXLS) {
  const mapa = new Map();

  dadosXLS.forEach(func => {
    if (func.barras) {
      mapa.set(String(func.barras).trim(), func);
    }
  });

  return mapa;
}

// Cruza CSV x XLS usando BARRAS (tipo PROCV)
function cruzarDados(dadosCSV, mapaXLS) {
  const registrosValidos = [];
  const registrosSemMatch = [];
  const matriculasProcessadas = new Set();

  dadosCSV.forEach(csv => {
    const barras = String(csv.barras || '').trim();

    if (!barras) {
      registrosSemMatch.push({
        motivo: 'CSV sem BARRAS',
        registro: csv
      });
      return;
    }

    const xls = mapaXLS.get(barras);

    if (!xls) {
      registrosSemMatch.push({
        motivo: 'BARRAS não encontrado no XLS',
        barras,
        registro: csv
      });
      return;
    }

    const matricula = xls.chapa ? Number(xls.chapa) : null;

    // Evita duplicidade se o mesmo funcionário estiver em múltiplos arquivos TXT
    if (matricula && matriculasProcessadas.has(matricula)) {
      return;
    }
    if (matricula) {
      matriculasProcessadas.add(matricula);
    }

    registrosValidos.push({
      matricula,
      nome: xls.nome || csv.nome || null,
      setor_folha: xls.setor_folha || null,
      nome_setor: xls.nome_setor || null,
      gerente: xls.gestor || null,
      funcao: xls.funcao || null,
      rfid: xls.rfid || csv.rfid || null,
      codbarras: xls.barras ? Number(xls.barras) : null,
      barras: barras
    });
  });

  return {
    registrosValidos,
    registrosSemMatch
  };
}

module.exports = {
  prepararMapaXLS,
  cruzarDados
};
