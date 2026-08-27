# ⚙️ Nexus Backend — API de Automação & Sincronização

API REST em **Node.js** com **Express**, integrada ao **PostgreSQL** e **Google Sheets API**. O backend é responsável pela leitura de arquivos CSV/TXT, cruzamento de dados com tabelas Excel (XLSX) através do código de barras e sincronização automática multi-destino.

---

## 🛠️ Tecnologias Utilizadas

- **Node.js** (v18+)
- **Express.js** (API REST e rotas de upload)
- **PostgreSQL** (Driver `pg` com suporte a transações SQL)
- **Google Sheets API v4** (`googleapis` com Service Account)
- **Multer** (Processamento de uploads de arquivos multipart)
- **XLSX & CSV-Parser** (Leitura e parse de planilhas e arquivos delimitados)

---

## 📂 Estrutura do Repositório

```
nexus-backend/
├── src/
│   ├── controllers/
│   │   └── importController.js    # Controle da rota de importação
│   ├── database/
│   │   └── connection.js          # Conexão com o PostgreSQL (pg.Pool)
│   ├── routes/
│   │   └── importRoutes.js        # Definição das rotas HTTP e Multer
│   ├── services/
│   │   ├── csvService.js          # Leitura de arquivos CSV / TXT
│   │   ├── xlsService.js          # Leitura de arquivos XLSX / XLS
│   │   ├── mergeService.js        # Cruzamento de dados (PROCV em memória)
│   │   ├── employeeService.js     # Inserção transacional no PostgreSQL
│   │   └── googleSheetsService.js # Sincronização com o Google Sheets API
│   ├── app.js                     # Configuração do Express e CORS
│   └── server.js                  # Inicialização do servidor HTTP
├── credentials/
│   └── google.json.example        # Modelo de chave Service Account do Google
├── uploads/
│   └── .gitkeep                   # Diretório temporário de uploads
├── .env.example                   # Modelo de variáveis de ambiente
├── .gitignore
├── package.json
└── README.md
```

---

## 🗄️ Configuração do Banco de Dados (PostgreSQL)

Antes de iniciar a API, crie o banco de dados e as tabelas executando o script SQL abaixo no seu PostgreSQL:

```sql
-- 1. Criar o banco de dados
CREATE DATABASE nexus;

-- 2. Conectar ao banco nexus
\c nexus;

-- 3. Criar o schema dedicado
CREATE SCHEMA IF NOT EXISTS colaborador;

-- 4. Criar Tabela 1: lista_funcionario
CREATE TABLE IF NOT EXISTS colaborador.lista_funcionario (
    matricula int8 NULL,
    nome text NULL,
    setor_folha text NULL,
    nome_setor text NULL,
    gerente text NULL,
    funcao text NULL,
    data_att text NULL,
    hora_att text NULL,
    CONSTRAINT lista_funcionario_matricula_key UNIQUE (matricula)
);

-- 5. Criar Tabela 2: colaboradores
CREATE TABLE IF NOT EXISTS colaborador.colaboradores (
    id bigserial NOT NULL,
    rfid int8 NULL,
    matricula int8 NULL,
    nome varchar NULL,
    usuarioupdate varchar NULL,
    updatedate timestamp NULL,
    codbarras int8 NULL,
    unidade_dass varchar(50) DEFAULT 'SEST',
    CONSTRAINT colaboradores_matricula_key UNIQUE (matricula),
    CONSTRAINT colaboradores_pk_sest PRIMARY KEY (id)
);
```

---

## 🔑 Configuração das Variáveis de Ambiente (.env)

Crie o arquivo `.env` na raiz da pasta `backend`:

```bash
cp .env.example .env
```

Preencha os dados no `.env`:

```env
PORT=3333

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=nexus
DB_USER=postgres
DB_PASSWORD=sua_senha

# Google Sheets (Opcional)
GOOGLE_SHEET_ID=ID_DA_PLANILHA_NO_GOOGLE
GOOGLE_SHEET_NAME=NomeDaAba
```

---

## ☁️ Configuração do Google Sheets (Opcional)

1. No Google Cloud Console, crie uma **Service Account** e ative a **Google Sheets API**.
2. Baixe a chave em formato JSON.
3. Salve a chave exatamente em: `credentials/google.json`.
4. Compartilhe sua planilha do Google Sheets com o e-mail da Service Account como **Editor**.

---

## 🚀 Como Iniciar

1. **Instalar dependências:**
   ```bash
   npm install
   ```

2. **Rodar em ambiente de desenvolvimento:**
   ```bash
   npm run dev
   ```

3. O servidor estará rodando em `http://localhost:3333`.

---

## 📡 Rota da API

### `POST /importar`
Recebe arquivos multipart/form-data:
- `csv` (Arquivo CSV/TXT 1)
- `csv2` (Arquivo CSV/TXT 2 - Opcional)
- `xls` (Arquivo XLSX/XLS - Base principal)

**Exemplo de Resposta:**
```json
{
  "mensagem": "Sincronização concluída com sucesso",
  "totalProcessados": 5615,
  "banco": {
    "inseridos": 150,
    "atualizados": 10,
    "ignorados": 5455,
    "erros": 0,
    "total": 5615
  },
  "planilha": {
    "inseridos": 150,
    "atualizados": 10,
    "ignorados": 5455,
    "erros": 0,
    "total": 5615
  }
}
```
