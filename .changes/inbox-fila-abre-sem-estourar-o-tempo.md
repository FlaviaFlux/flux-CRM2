---
impacto: nada_mudou
secao: corrigido
titulo: A Fila do Inbox abre sem "Erro interno"
---

Em organizações com muitas conversas, a aba Fila do Inbox demorava vários segundos, às vezes parava em "Erro interno. Tente de novo em instantes." e deixava os números das abas pesando no servidor. O banco conferia, conversa por conversa, quem podia vê-la e quem estava no comando dela. Agora a permissão é conferida uma vez por consulta, e a Fila e a aba Automático usam índices próprios. Quem vê cada conversa continua exatamente igual.

Você não precisa fazer nada: a atualização aplica a migração sozinha.
