# Dashboard de Vagas (Agenda Edu)

Lê a planilha de Controle de Vagas (abas 2024, 2025 e 2026) e mostra status, SLA, prazos, área/BU/liderança e recrutadoras.

## Como os dados sensíveis ficam protegidos

- A planilha é lida **só no servidor** (`api/vagas.js`). Apenas os campos da lista `CAMPOS_LIBERADOS` chegam ao navegador.
- **Nunca saem do servidor:** orçamento/salário, pessoa substituída, vaga afirmativa/PCD e código da vaga.
- O site inteiro (páginas e API) pede **usuário e senha** (`middleware.js`).
- Usuário, senha e ID da planilha ficam em **variáveis de ambiente**, nunca no código. O `.env` está no `.gitignore`.
- As páginas têm `noindex`, então não aparecem no Google.

## Estrutura

```
dashboard-vagas/
├── api/vagas.js      ← lê a planilha e filtra os campos (servidor)
├── middleware.js     ← pede usuário e senha
├── index.html        ← página
├── style.css         ← visual (cores Bemobi)
├── app.js            ← gráficos e tabelas (navegador)
├── package.json
├── .env.example      ← modelo das variáveis
└── .gitignore
```

## Passo a passo

### 1. Abrir no VS Code
1. Instale o [Node.js](https://nodejs.org) (versão 18 ou mais nova).
2. Abra a pasta `dashboard-vagas` no VS Code (**Arquivo → Abrir pasta**).
3. Abra o terminal (**Terminal → Novo terminal**) e instale a CLI do Vercel:
   ```
   npm i -g vercel
   ```

### 2. Configurar as variáveis locais
1. Copie `.env.example` e renomeie a cópia para `.env`.
2. Troque `DASHBOARD_PASSWORD` por uma senha forte.

### 3. Rodar no seu computador
```
vercel login
vercel dev
```
Na primeira vez, o Vercel faz algumas perguntas. Escolha o **time corporativo da Bemobi** (não a conta pessoal) e aceite as opções padrão.
Depois abra http://localhost:3000 e entre com o usuário e a senha do `.env`.

> A planilha precisa estar compartilhada como "Qualquer pessoa com o link pode ver" para o servidor conseguir ler.
> Se ela não puder ficar assim, peça ajuda à TI para trocar a leitura por uma conta de serviço do Google.

### 4. Publicar no Vercel
1. No site do Vercel, abra o projeto e vá em **Settings → Environment Variables**.
2. Cadastre `SHEET_ID`, `DASHBOARD_USER`, `DASHBOARD_PASSWORD` e `DATE_ORDER` com os mesmos valores do `.env`.
3. No terminal:
   ```
   vercel --prod
   ```

### 5. Versionar (opcional)
Suba o código no Bitbucket da Bemobi (workspace **git-m4u**) e conecte o repositório ao projeto no Vercel. Assim cada alteração publica sozinha.

## Atualização dos dados
Continue preenchendo a planilha original. O dashboard busca os dados de novo a cada 5 minutos.

## Ajustes comuns
- **Liberar um campo novo:** adicione-o em `CAMPOS_LIBERADOS` (`api/vagas.js`). Antes, confira se ele não é sensível.
- **Datas trocadas (dia/mês):** mude `DATE_ORDER` para `mdy`.
- **Nova aba de ano:** adicione-a na lista `ABAS` em `api/vagas.js`.
