# Empresas e acessos no Campo Certo

O administrador existente continua sendo o único administrador do sistema. Nenhum cliente recebe esse perfil. O administrador cadastra empresas e usuários; usuários comuns trabalham somente na empresa à qual foram vinculados. O domínio e o servidor podem continuar os mesmos.

## Uso

1. Entre com a conta de administrador e abra **Usuários**.
2. Em **Empresas clientes**, crie a empresa. Ela começa sem produtores, fazendas, participantes, notas ou estoque.
3. Em **Novo usuário**, selecione explicitamente a empresa. Vários usuários podem compartilhar a mesma empresa.
4. Para acompanhar um cliente, o administrador usa **Empresa em uso**, no cabeçalho. A tela é recarregada para remover dados e trabalhos pendentes da empresa anterior. Esse seletor não aparece para os demais usuários.
5. Renomeie **Empresa original** para o nome da empresa atual, se desejar.

O botão **Excluir**, ao lado de **Renomear**, pede confirmação e remove a empresa da lista ativa. Seus usuários perdem o acesso imediatamente e não podem entrar novamente. Trata-se de uma exclusão lógica: o banco e as contas permanecem arquivados, sem apagar os arquivos. A empresa original não pode ser excluída. Se estiver usando a empresa excluída, o administrador retorna à empresa original. Não há restauração pelo painel nesta versão.

Trocar a empresa de um usuário não move registros: encerra suas sessões e muda o conjunto de dados que ele poderá acessar após entrar novamente. Alterar sua senha também revoga sessões. Não existe opção de criar outro administrador, promover usuários ou excluir o administrador atual. E-mails de login permanecem únicos no sistema inteiro.

## Organização dos bancos

- `data/produtor-rural.db`: contas, cadastro de empresas e os dados da empresa original (ID 1).
- `data/companies/<id>.db`: dados exclusivos de cada nova empresa, sem cópia dos dados originais e sem tabela de usuários.
- `data/backups/before-companies-<data>.db`: cópia consistente da base legada, criada antes da primeira migração.

`DATA_DIR` permite usar outro diretório persistente; o padrão continua sendo `data` na instalação do aplicativo. Os caminhos dos bancos são gerados no servidor a partir de IDs inteiros existentes; o navegador não informa caminhos de arquivos.

Todas as rotas de negócio recebem a conexão correspondente ao usuário autenticado. O cabeçalho `X-Company-Id` só permite trocar de empresa ao administrador. Downloads de XML, importações, relatórios, planilhas, PDFs, exclusões em lote e estoque usam o mesmo contexto. CPFs, inscrições estaduais e duplicidades de XML são verificados dentro do banco da empresa. Se um banco de cliente estiver ausente, a API retorna indisponibilidade: não cria silenciosamente outro banco vazio.

## Atualização da instalação existente

Esta versão exige nova entrada no sistema após a atualização; tokens antigos serão recusados. Usuários existentes ficam vinculados à empresa original. IDs, senhas, administrador e registros existentes são preservados. A migração recusa bases com usuários mas sem um único administrador identificado; não escolhe nem promove uma conta por conta própria.

1. Rode `npm test` e `npm run build` no código novo.
2. Faça um ensaio com `npm run check:migration`: ele migra uma cópia temporária da base local, compara registros e contas e remove essa cópia. Não execute o servidor apontando para a base em uso durante o ensaio.
3. No servidor da empresa, pare o serviço e faça um backup de **toda a pasta persistente `data`**, incluindo `companies` e arquivos SQLite `-wal`/`-shm` que existirem. Preserve também o segredo JWT e o programa anterior para restauração.
4. Atualize os arquivos do programa e a interface compilada. Use o atualizador normal (`Atualizar Campo Certo.cmd`) para instalações Windows existentes, preservando `app/data`; não restaure um pacote antigo de migração sobre a base em uso.
5. Confirme que `JWT_SECRET` é uma chave exclusiva com pelo menos 32 caracteres. Inicie uma única instância do servidor sobre esse diretório. O backup automático da base legada e a migração são executados na primeira inicialização.
6. Entre como administrador, confira a empresa original, crie uma empresa de teste e verifique o isolamento antes de liberar clientes.

Para voltar à versão anterior, pare o serviço e restaure em conjunto o código anterior e o backup completo anterior à atualização. Não rode o código antigo sobre a estrutura multiempresa: ele não conhece o isolamento.

Backups posteriores à migração devem conter o banco principal **e todos os bancos em `companies`**. Copiar somente `produtor-rural.db` deixa de ser um backup completo. Faça a cópia com o serviço parado; copiar arquivos SQLite em uso diretamente pode gerar um backup inconsistente.

## Validação

`npm test` cobre a preservação do administrador e dos dados legados, rejeição de sessões antigas, cadastro inicial concorrente, criação de empresas vazias, administração restrita, tentativas de acesso entre empresas, importação repetida dentro e entre empresas, XMLs, estoque, relatórios, vínculos de registros, exclusão em lote, transferência de usuários, reinicialização e ausência do arquivo de uma empresa.

O módulo antigo que podia excluir notas automaticamente ao iniciar por divergência de CPF foi retirado da inicialização. Importações novas continuam validadas; a atualização não remove notas legadas automaticamente.
