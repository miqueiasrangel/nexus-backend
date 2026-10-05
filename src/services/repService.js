const http = require('http');
const https = require('https');

function obterConfiguracaoREP() {
  const dispositivos = [
    {
      id: 'rep1',
      host: process.env.REP_1_HOST,
      username: process.env.REP_1_USER,
      password: process.env.REP_1_PASSWORD
    },
    {
      id: 'rep2',
      host: process.env.REP_2_HOST,
      username: process.env.REP_2_USER,
      password: process.env.REP_2_PASSWORD
    }
  ];

  const ausentes = dispositivos.filter(
    (dispositivo) => !dispositivo.host || !dispositivo.username || !dispositivo.password
  );

  if (ausentes.length > 0) {
    const erro = new Error('Os dois REPs precisam estar configurados no ambiente.');
    erro.code = 'REP_CONFIG_ERROR';
    erro.details = ausentes.map((dispositivo) => dispositivo.id);
    throw erro;
  }

  return dispositivos.map((dispositivo) => ({
    ...dispositivo,
    loginPath: process.env.REP_LOGIN_PATH || '/login.fcgi',
    exportPath: process.env.REP_EXPORT_PATH || '/export_users_csv.fcgi',
    timeoutMs: Number(process.env.REP_TIMEOUT_MS || 15000),
    rejectUnauthorized: process.env.REP_TLS_VERIFY !== 'false',
    insecureHTTPParser: process.env.REP_INSECURE_HTTP_PARSER !== 'false'
  }));
}

function interpretarHost(host) {
  const valor = String(host).includes('://') ? String(host) : 'https://' + String(host);
  const url = new URL(valor);

  return {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || undefined
  };
}

function extrairCookies(headers) {
  const setCookie = headers['set-cookie'] || [];
  return setCookie
    .map((cookie) => String(cookie).split(';')[0])
    .filter(Boolean)
    .join('; ');
}

function fazerPostJSON(config, caminho, payload, cookies) {
  const destino = interpretarHost(config.host);
  const protocolo = destino.protocol === 'http:' ? http : https;
  const corpo = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const request = protocolo.request(
      {
        protocol: destino.protocol,
        hostname: destino.hostname,
        port: destino.port,
        path: caminho,
        method: 'POST',
        rejectUnauthorized: config.rejectUnauthorized,
        insecureHTTPParser: config.insecureHTTPParser,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(corpo),
          ...(cookies ? { Cookie: cookies } : {})
        }
      },
      (response) => {
        const partes = [];

        response.on('data', (parte) => partes.push(Buffer.from(parte)));
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(partes)
          });
        });
      }
    );

    request.setTimeout(config.timeoutMs, () => {
      request.destroy(new Error('Timeout ao acessar o dispositivo REP.'));
    });

    request.on('error', reject);
    request.write(corpo);
    request.end();
  });
}

async function coletarREP(dispositivo) {
  const loginResponse = await fazerPostJSON(
    dispositivo,
    dispositivo.loginPath,
    {
      login: dispositivo.username,
      password: dispositivo.password
    }
  );

  if (loginResponse.statusCode < 200 || loginResponse.statusCode >= 300) {
    const erro = new Error(
      dispositivo.id + ' recusou o login. Status: ' + loginResponse.statusCode
    );
    erro.code = 'REP_LOGIN_ERROR';
    throw erro;
  }

  let loginData;
  try {
    loginData = JSON.parse(loginResponse.body.toString('utf8'));
  } catch (erro) {
    const erroResposta = new Error(dispositivo.id + ' retornou um login inválido.');
    erroResposta.code = 'REP_LOGIN_RESPONSE_ERROR';
    throw erroResposta;
  }

  if (!loginData.session) {
    const erro = new Error(dispositivo.id + ' não retornou um token de sessão.');
    erro.code = 'REP_SESSION_ERROR';
    throw erro;
  }

  const cookies = extrairCookies(loginResponse.headers);
  const exportResponse = await fazerPostJSON(
    dispositivo,
    dispositivo.exportPath,
    { session: loginData.session },
    cookies
  );

  if (exportResponse.statusCode < 200 || exportResponse.statusCode >= 300) {
    const erro = new Error(
      dispositivo.id + ' falhou ao exportar usuários. Status: ' + exportResponse.statusCode
    );
    erro.code = 'REP_EXPORT_ERROR';
    throw erro;
  }

  if (exportResponse.body.length === 0) {
    const erro = new Error(dispositivo.id + ' retornou um arquivo vazio.');
    erro.code = 'REP_EMPTY_EXPORT';
    throw erro;
  }

  return {
    id: dispositivo.id,
    host: dispositivo.host,
    content: exportResponse.body.toString('utf8'),
    bytes: exportResponse.body.length
  };
}

async function coletarREPs() {
  const dispositivos = obterConfiguracaoREP();
  const resultados = await Promise.allSettled(
    dispositivos.map((dispositivo) => coletarREP(dispositivo))
  );

  const falhas = resultados
    .map((resultado, indice) => ({ resultado, dispositivo: dispositivos[indice] }))
    .filter(({ resultado }) => resultado.status === 'rejected')
    .map(({ resultado, dispositivo }) => ({
      dispositivo: dispositivo.id,
      codigo: resultado.reason && resultado.reason.code
        ? resultado.reason.code
        : 'REP_UNKNOWN_ERROR',
      mensagem: resultado.reason && resultado.reason.message
        ? resultado.reason.message
        : 'Falha desconhecida na coleta.'
    }));

  if (falhas.length > 0) {
    const erro = new Error('Não foi possível coletar todos os REPs.');
    erro.code = 'REP_COLLECTION_ERROR';
    erro.details = falhas;
    throw erro;
  }

  return resultados.map((resultado) => resultado.value);
}

module.exports = {
  coletarREP,
  coletarREPs,
  obterConfiguracaoREP
};
