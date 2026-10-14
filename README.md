# Campo Certo — Gestão de Produtor Rural

Aplicação web completa para cadastrar produtores, fazendas e participantes, importar notas fiscais eletrônicas em XML e conferir os dados extraídos.

O sistema separa os dados por empresa e mantém um único administrador. Consulte [empresas, acessos e migração](docs/multiempresa.md) antes de atualizar uma instalação existente. Clientes novos são cadastrados pelo administrador em **Usuários → Empresas clientes**.

## Como executar

Requisitos: Node.js 18 ou superior.

No Windows, dê dois cliques em `iniciar-produtorr.cmd`. O atalho instala as dependências na primeira execução, inicia o frontend e o backend e abre o navegador automaticamente. Para encerrar, pressione `Ctrl+C` na janela do atalho.

Ou execute manualmente:

```bash
npm install
npm run dev
```

Abra `http://localhost:5173` e entre com a conta de administrador. Novos acessos e empresas são criados pelo administrador em **Usuários**. A API roda em `http://localhost:3333` e o banco SQLite é criado automaticamente em `data/produtor-rural.db`.

## Recursos

- Login com senha criptografada e sessão JWT; um único administrador cria os usuários.
- Várias empresas clientes, cada uma com seu próprio banco isolado ([detalhes](docs/multiempresa.md)).
- Cadastro de produtores rurais, fazendas (com sócios e participação) e participantes.
- Importação de vários XMLs ou de uma pasta inteira, com detecção de notas duplicadas.
- Extração automática de data, número, valor, chave de acesso, emitente, classificação por NCM (gado, soja, outros) e quantidade de cabeças nas notas de gado (unidades CB, CAB, UN, VOL...; vendas por peso ficam para preenchimento manual).
- Conferência por produtor, fazenda, ano ou mês em grade editável, com lançamentos manuais e atalhos de pendências: notas não conferidas, sem fazenda, sem participante, gado sem quantidade e possíveis duplicadas.
- Busca de notas na SEFAZ (Distribuição DF-e) com o certificado A1 do produtor, com ciência da operação automática para liberar o XML completo ([como testar](docs/sefaz-e-lcdpr.md)).
- Exportação da conferência em planilha, dos XMLs em ZIP e da DANFE em PDF com texto selecionável (individual ou em lote), além da visualização da nota na tela.
- Comprovantes (PDF ou imagem) anexados aos lançamentos manuais.
- Resumo anual (livro-caixa) com impressão, exportação para o programa do IRPF e geração do arquivo do LCDPR.
- Estoque e movimentação de animais, com referência às quantidades das notas.
- Painel com gráfico mensal de receitas e despesas por produtor (e fazenda, opcional).
- Backup automático diário de todos os bancos.
- Cada tela tem seu endereço (por exemplo, `/#/conferencia`), então atualizar a página e o botão voltar funcionam.
- Tema claro e escuro; interface responsiva para desktop e celular.

## Comandos

```bash
npm run dev       # frontend e backend em desenvolvimento
npm test          # testes do leitor de NF-e, empresas, backup, anexos, LCDPR e SEFAZ (com um servidor SEFAZ simulado)
npm run build     # gera a interface de produção em dist/
npm start         # inicia somente a API
```

## Backups

O servidor faz uma cópia consistente de **todos** os bancos (contas, empresa original e `companies/*.db`) alguns minutos depois de iniciar e, a partir daí, uma vez por dia. As cópias ficam em `data/backups/automaticos/<data_hora>/` e as 10 mais recentes são mantidas. O administrador acompanha o último backup e pode fazer uma cópia na hora em **Usuários → Backups automáticos**.

Variáveis opcionais: `BACKUP_DIR` (outra pasta, por exemplo em outro disco), `BACKUP_KEEP` (quantas cópias manter) e `BACKUP_DISABLED=1` (desliga o agendamento).

As cópias ficam no mesmo disco do servidor. Para se proteger de falha do disco, copie periodicamente a pasta de backups para outro lugar.

Para restaurar: pare o serviço, guarde a pasta `data` atual em outro lugar, copie `produtor-rural.db` e a pasta `companies` da cópia escolhida para `data` (removendo os arquivos `-wal`/`-shm` antigos) e inicie o serviço novamente.

## Atualizar o servidor da empresa

Execute `scripts\gerar-atualizacao.ps1` no PowerShell. Ele roda os testes, gera a interface e cria `releases\CampoCerto-Atualizacao-<data>.zip` com o programa, as dependências e o atualizador. O pacote não leva banco, contas nem credenciais. No servidor, extraia o ZIP e execute `Atualizar Campo Certo.cmd` como administrador; os dados em `app\data` e a chave JWT são preservados.

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
