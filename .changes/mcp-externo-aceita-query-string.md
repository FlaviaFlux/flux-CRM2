---
impacto: nada_mudou
secao: corrigido
titulo: O servidor MCP externo aceita parâmetros no endereço
---

Servidores MCP que se identificam por parâmetro na URL, como o da Stays (`?clientId=`), agora podem ser cadastrados. Antes, qualquer endereço com `?` era recusado como inseguro. Endereços com `#` ou com usuário e senha embutidos continuam recusados. A auditoria e o log registram só o host do servidor, então o parâmetro não aparece neles.
