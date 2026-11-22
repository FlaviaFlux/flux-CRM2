---
impacto: nada_mudou
secao: corrigido
titulo: A tela de atualização reconhece a versão da distribuição Flux
---

Depois de atualizar para a 1.123.0-flux.2, a tela Atualização do sistema mostrava "Versão instalada: Ainda não confirmada", com "?" no lugar da versão de cada serviço, e o botão de atualizar recusaria a próxima versão com "A execução dos serviços ainda não foi confirmada". O sistema funcionava normalmente: só a conferência da versão não reconhecia o sufixo `-flux.N`.

Agora a versão da distribuição é reconhecida, e a próxima atualização pode ser feita pela tela. Esta correção chega pelo botão só a partir da versão seguinte a esta; para aplicá-la agora, rode no servidor `bash hostgator-setup-kit/update.sh` uma vez.
