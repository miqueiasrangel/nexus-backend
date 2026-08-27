const fs = require('fs');
const { google } = require('googleapis');
const path = require('path');

const credentialsPath = path.join(__dirname, '../../credentials/google.json');

async function getSheets() {
  if (!fs.existsSync(credentialsPath)) {
    throw new Error('Arquivo credentials/google.json não encontrado');
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

function normalizar(valor) {
  if (valor === undefined || valor === null) return '';
  return String(valor).trim();
}

// REGRA AUTOMÁTICA DE TURNO
function calcularTurno(setor) {
  const texto = normalizar(setor);

  if (!texto) return 'C';

  // pega última letra válida
  const ultimaLetra = texto.trim().slice(-1).toUpperCase();

  if (ultimaLetra === 'A') return 'A';
  if (ultimaLetra === 'B') return 'B';

  return 'C';
}

async function sincronizarPlanilha(spreadsheetId, sheetName, funcionarios) {
  const sheets = await getSheets();

  // LÊ PLANILHA ATUAL
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName
  });

  let rows = response.data.values || [];

  if (rows.length === 0) {
    rows = [
      ['CHAPA', 'NOME', 'SETOR', 'GESTOR', 'TURNO', 'RFID', 'BARRAS']
    ];
  }

  const mapa = new Map();

  // Monta mapa por CHAPA (coluna A = index 0)
  rows.forEach((row, index) => {
    const chapa = normalizar(row[0]);
    if (chapa && chapa.toUpperCase() !== 'CHAPA') {
      mapa.set(chapa, index);
    }
  });

  let inseridos = 0;
  let atualizados = 0;
  let ignorados = 0;

  // PROCESSA EM MEMÓRIA
  for (const func of funcionarios) {
    const chapa = normalizar(func.matricula);
    const nome = normalizar(func.nome);
    const setor = normalizar(func.nome_setor);
    const gestor = normalizar(func.gerente);
    const rfid = normalizar(func.rfid);
    const barras = normalizar(func.barras || func.codbarras);

    if (!chapa) continue;

    const turnoCalculado = calcularTurno(setor);
    const linhaIndex = mapa.get(chapa);

    // NÃO EXISTE → INSERE (Colunas: A:CHAPA, B:NOME, C:SETOR, D:GESTOR, E:TURNO, F:RFID, G:BARRAS)
    if (linhaIndex === undefined) {
      rows.push([
        chapa,           // A (CHAPA)
        nome,            // B (NOME)
        setor,           // C (SETOR)
        gestor,          // D (GESTOR)
        turnoCalculado,  // E (TURNO - calculado pela última letra)
        rfid,            // F (RFID)
        barras           // G (BARRAS)
      ]);

      inseridos++;
      continue;
    }

    // EXISTE → COMPARA
    const linhaAtual = rows[linhaIndex];

    const nomeAtual = normalizar(linhaAtual[1]);
    const setorAtual = normalizar(linhaAtual[2]);
    const gestorAtual = normalizar(linhaAtual[3]);
    const turnoAtual = normalizar(linhaAtual[4]);
    const rfidAtual = normalizar(linhaAtual[5]);
    const barrasAtual = normalizar(linhaAtual[6]);

    if (
      nomeAtual === nome &&
      setorAtual === setor &&
      gestorAtual === gestor &&
      turnoAtual === turnoCalculado &&
      rfidAtual === rfid &&
      barrasAtual === barras
    ) {
      ignorados++;
      continue;
    }

    // Atualiza em memória
    linhaAtual[0] = chapa;
    linhaAtual[1] = nome;
    linhaAtual[2] = setor;
    linhaAtual[3] = gestor;
    linhaAtual[4] = turnoCalculado;
    linhaAtual[5] = rfid;
    linhaAtual[6] = barras;

    atualizados++;
  }

  // ENVIA TUDO DE UMA VEZ
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: rows
    }
  });

  return {
    inseridos,
    atualizados,
    ignorados,
    erros: 0,
    total: inseridos + atualizados + ignorados
  };
}

module.exports = { sincronizarPlanilha };