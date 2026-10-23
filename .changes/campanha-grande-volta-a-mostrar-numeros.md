---
impacto: nada_mudou
secao: corrigido
titulo: Campanha grande volta a mostrar os números e a lista
---

Em campanhas com mais de mil destinatários, a tela da campanha mostrava os números zerados, escondia a barra de progresso e deixava vazia a lista "Quem está na lista". O banco desistia da consulta por tempo: para cada destinatário, ele conferia de novo a permissão de escrita de quem estava olhando. Agora a leitura confere só a permissão de leitura, uma vez por consulta. Numa campanha de 1511 pessoas, a consulta cai de 12 segundos para milissegundos. Quem pode ver e quem pode alterar continua exatamente igual.

Você não precisa fazer nada: a atualização aplica a migração sozinha.
