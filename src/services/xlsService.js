const xlsx = require('xlsx');

function lerXLS(caminhoArquivo) {
  const workbook = xlsx.readFile(caminhoArquivo);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const dados = xlsx.utils.sheet_to_json(sheet);

return dados.map(linha => ({
  chapa: linha.CHAPA ? Number(linha.CHAPA) : null,
  nome: linha.NOME || null,
  gestor: linha.GESTOR || null,

  // setor_folha será o COD_SETOR
  setor_folha: linha.COD_SETOR || null,

  // nome_setor será o NOME_SETOR
  nome_setor: linha.NOME_SETOR || null,

  funcao: linha.FUNCAO || null,

  barras: linha['Cracha Cript ERP'] || null,

  rfid: linha.RFID || null
}));

}

module.exports = { lerXLS };
