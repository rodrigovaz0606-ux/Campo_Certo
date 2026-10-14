# Busca na SEFAZ e LCDPR: como testar

## Busca de notas na SEFAZ (certificado A1)

O sistema consulta o serviço nacional de Distribuição DF-e da Receita com o certificado A1 (e-CPF) do produtor. Esse serviço devolve as notas em que o CPF do produtor é **destinatário** (compras e entradas). As notas **emitidas pelo próprio produtor** (vendas, NFA-e da Agrodefesa) não vêm por esse serviço: continue importando esses XMLs pela tela de importação.

### Cadastrar o certificado

1. Em **Produtores**, clique no ícone de escudo na linha do produtor.
2. Escolha o arquivo `.pfx` ou `.p12`, digite a senha e confira a UF.
3. O sistema confere a senha e a validade, e também se o CPF do certificado é o do produtor. O arquivo e a senha ficam guardados cifrados (AES-256) no banco da empresa. O certificado pode ser removido no mesmo lugar.

O certificado precisa ser do próprio produtor. O e-CNPJ do escritório não serve para consultar as notas de um CPF.

### Buscar as notas

1. Em **Importar notas → Buscar notas na SEFAZ**, escolha o produtor e clique em **Buscar notas agora**.
2. As notas completas são importadas na hora e aparecem na Conferência, como numa importação de XML.
3. Quando a SEFAZ manda só o **resumo** de uma nota, o sistema registra automaticamente a **Ciência da Operação** (evento 210210). Isso libera o XML completo, que chega numa próxima busca.
4. Quando não há mais documentos novos, a SEFAZ exige **1 hora de espera** antes de consultar de novo o mesmo CPF. O botão mostra o horário liberado. Consultar antes disso faz a SEFAZ bloquear o CPF por "consumo indevido" (código 656).

Na primeira busca, a SEFAZ pode devolver notas dos últimos 3 meses (é o limite do serviço). Notas mais antigas precisam ser importadas pelo XML.

### Respostas mais comuns da SEFAZ

| Código | Significado | O que fazer |
|---|---|---|
| 138 | Documentos encontrados | Nada: as notas foram processadas. |
| 137 | Nenhum documento novo | Esperar 1 hora e buscar de novo. |
| 656 | Consumo indevido | Esperar 1 hora; o sistema já bloqueia o botão. |
| 593 / 594 | CPF diferente do certificado | Conferir se o certificado é do produtor certo. |
| 403 | Certificado recusado | Conferir se é A1 válido, não vencido e ICP-Brasil. |

Para testar só a consulta, sem registrar a Ciência da Operação, inicie o servidor com a variável `SEFAZ_MANIFESTAR=0`.

Se aparecer algum outro erro durante o teste na empresa, anote a mensagem exibida (ela traz o código da SEFAZ) para ajustarmos.

## LCDPR

Em **Resumo anual**, escolha o produtor e o ano e clique em **Gerar LCDPR**.

Na primeira vez, preencha os dados que o LCDPR pede e o sistema ainda não tinha: código IBGE do município (7 dígitos), conta bancária, NIRF e tipo de exploração de cada fazenda, e o contador responsável. Eles ficam salvos para os próximos anos; os dados do contador valem para todos os produtores da empresa.

O arquivo segue o layout 1.3 do LCDPR, com os registros 0000, 0010, 0030, 0040, 0045, 0050, Q100, Q200 e 9999:

- saídas viram receitas (tipo 1) e entradas viram despesas (tipo 2);
- os valores levam duas casas decimais implícitas;
- os lançamentos sem fazenda vão para o imóvel padrão escolhido no formulário;
- todos os lançamentos usam a conta bancária informada.

**Antes de transmitir**, abra o arquivo no programa do LCDPR da Receita e rode a validação. Se o programa apontar erro em algum registro, anote a linha e a mensagem para ajustarmos o gerador.

## Consulta de inscrição estadual no cadastro de fazendas

No cadastro da fazenda, ao lado da inscrição estadual, o botão **Buscar na SEFAZ** consulta o cadastro oficial de contribuintes (a mesma base do Sintegra). Ele preenche endereço, número, complemento, bairro e CEP e mostra a situação da inscrição (habilitada ou não) e o titular.

- **Titular:** se o titular não for o produtor escolhido nem um sócio cadastrado, aparece um aviso em vermelho.
- **Município:** o código IBGE do município é guardado nos dados do LCDPR da fazenda, se ainda não estiver preenchido.
- **Certificado usado:** o do produtor, se ele tiver um cadastrado; senão, o **certificado do escritório**, cadastrado em **Usuários → Certificado do escritório** (e-CNPJ ou e-CPF A1).
- **Estados:** Goiás foi testado com consulta real. Também estão configurados MT, MS, MG, SP, PR, RS, BA e PE. Os estados que não oferecem esse serviço exigem preenchimento manual.
