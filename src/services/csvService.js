const fs = require('fs');
const csv = require('csv-parser');

function lerCSV(caminhoArquivo) {
  return new Promise((resolve, reject) => {
    const resultados = [];

    fs.createReadStream(caminhoArquivo)
      .pipe(csv({ separator: ';' }))
      .on('data', (linha) => {
        resultados.push({
          cpf: linha.cpf,
          nome: linha.nome,
          administrador: linha.administrador,
          matricula: linha.matricula,
          rfid: linha.rfid,
          codigo: linha.codigo,
          senha: linha.senha,
          barras: linha.barras,
          digitais: linha.digitais
        });
      })
      .on('end', () => resolve(resultados))
      .on('error', (erro) => reject(erro));
  });
}

module.exports = { lerCSV };
