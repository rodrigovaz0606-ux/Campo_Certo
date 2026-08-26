# Campo Certo — Gestão de Produtor Rural

Aplicação web completa para cadastrar produtores, fazendas e participantes, importar notas fiscais eletrônicas em XML e conferir os dados extraídos.

## Como executar

Requisitos: Node.js 18 ou superior.

No Windows, dê dois cliques em `iniciar-produtorr.cmd`. O atalho instala as dependências na primeira execução, inicia o frontend e o backend e abre o navegador automaticamente. Para encerrar, pressione `Ctrl+C` na janela do atalho.

Ou execute manualmente:

```bash
npm install
npm run dev
```

Abra `http://localhost:5173`, crie uma conta e comece pelos cadastros. A API roda em `http://localhost:3333` e o banco SQLite é criado automaticamente em `data/produtor-rural.db`.

## Recursos

- Login e criação de conta com senha criptografada e sessão JWT.
- Cadastro e exclusão de produtores rurais, fazendas e participantes.
- Fazendas associadas a produtores e classificadas como propriedade única ou com participação.
- Importação de vários XMLs ou de uma pasta inteira.
- Extração automática de data, número, valor, chave de acesso e emitente da NF-e.
- Conferência por produtor e fazenda em tabela editável.
- Download do XML original e exclusão da nota.
- Interface responsiva para desktop e celular.

## Comandos

```bash
npm run dev       # frontend e backend em desenvolvimento
npm test          # teste do leitor de NF-e
npm run build     # gera a interface de produção em dist/
npm start         # inicia somente a API
```

Em produção, defina `JWT_SECRET` com uma chave segura. As opções disponíveis estão documentadas em `.env.example`.

## Executar com Docker

Com Docker Desktop aberto, execute:

```bash
docker compose up --build -d
```

Abra `http://localhost:8080`. O frontend, o backend e o banco serão iniciados juntos. Os dados do SQLite ficam no volume persistente `produtor-rural-data`, portanto não são perdidos ao recriar o container.

Comandos úteis:

```bash
docker compose ps             # mostra o estado e a saúde do container
docker compose logs -f app    # acompanha os logs
docker compose down           # encerra sem apagar os dados
docker compose down -v        # encerra e apaga também o banco persistido
```

Para usar outra porta, crie um arquivo `.env` com `APP_PORT=8081`. Antes de publicar o sistema, também defina nele uma chave longa e aleatória em `JWT_SECRET`.
