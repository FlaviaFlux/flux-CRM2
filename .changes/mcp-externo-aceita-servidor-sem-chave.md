---
impacto: nada_mudou
secao: corrigido
titulo: O servidor MCP externo pode ser salvo sem chave
---

Servidores MCP que se identificam pela própria URL, como o da Stays (`?clientId=`), recusavam a chamada quando o CRM enviava uma chave como Bearer. A tela Servidor MCP externo exigia chave para salvar, então não havia como cadastrá-los. Agora a chave pode ficar em branco: nesse caso nenhuma autorização é enviada. Só o endereço em branco apaga o registro (use Remover). Quem já tinha chave cadastrada não precisa mudar nada.
