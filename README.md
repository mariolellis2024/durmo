# DURMO

Diário do sono pensado primeiro para celular. A versão local tem cadastro e acesso por e-mail e PIN, perfil pessoal, calendário próprio em português do Brasil, diário, estimativas automáticas, resumo semanal e um plano guiado de quatro semanas.

## Rodar localmente

Requisitos: Node.js 22 ou superior e PostgreSQL 16.

1. Crie um banco local chamado `durmo_dev`.
2. Copie `.env.example` para `.env` e ajuste `DATABASE_URL` para a configuração local do PostgreSQL.
3. Instale as dependências com `npm install`.
4. Inicie o app com `npm run dev`.
5. Abra `http://localhost:3000`.

Na primeira inicialização, o app cria as tabelas do diário e das contas no banco informado.

## EasyPanel

O `easypanel-schema.json` cria o app DURMO com origem Git (`https://github.com/mariolellis2024/durmo.git`, branch `main`) e um PostgreSQL 16 no projeto EasyPanel em que você está. O formato segue a lista de serviços do schema funcional do Alanis: cada item tem `type` e `data`, sem `projectName` dentro de cada serviço. Não inclui domínio no schema; depois de criar os serviços, configure `app.durmo.com.br` no serviço `durmo`, apontando para a porta interna `3000`, com HTTPS. O projeto não precisa de MinIO. Antes de importar, substitua `DEFINIR_SENHA_FORTE_ANTES_DE_IMPORTAR` nas duas linhas pela mesma senha; não publique a senha no GitHub. O EasyPanel constrói o app a partir do repositório Git.

## Dados do app

Cada conta tem seu próprio diário. O servidor aplica o filtro da conta ao consultar e salvar noites. O PIN não é armazenado em texto puro e a sessão fica vinculada ao banco local.

O tempo estimado dormindo desconta do tempo na cama o período até apagar a luz, a demora para adormecer, os minutos acordado durante a noite e o intervalo entre o último despertar e sair da cama. O resumo usa sete datas consecutivas e informa quantas noites têm registro; suas médias consideram as noites preenchidas. Os hábitos da Semana 1 em diante aparecem separados da observação da Semana 0.

No primeiro acesso, o app pede primeiro nome, data de nascimento e sexo (com opção de não informar). A idade é calculada a partir da data de nascimento para aplicar a meta prevista no guia. O plano registra a autoavaliação inicial e final, pede uma checagem de segurança, coleta sete noites por semana e conduz as etapas 0 a 4. Com sete noites da Semana 0 e um horário fixo para acordar, calcula a janela média em blocos de 15 minutos (mínimo de 5 horas). Nas Semanas 1 a 3, calcula a eficiência e apresenta a sugestão correspondente ao guia: aumentar, manter ou reduzir a janela. Para pessoas com 65 anos ou mais, usa 85% como meta de aumento. Uma checagem positiva bloqueia os cálculos automáticos e orienta conversar com um profissional; o diário continua disponível.

O plano é educativo: pontuações e cálculos são registros pessoais, não diagnóstico nem substituto de atendimento profissional. Esta versão ainda não envia e-mails e não oferece recuperação de PIN.
