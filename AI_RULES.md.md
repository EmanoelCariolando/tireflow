# AI_RULES.md

## Objetivo

Este arquivo define as regras permanentes para qualquer IA que participar do desenvolvimento do projeto **TireFlow**.

Estas regras têm prioridade sobre sugestões da IA, desde que não entrem em conflito com a SPEC do projeto.

---

# Regra 1 — A SPEC é a fonte de verdade

Antes de qualquer implementação, leia completamente:

```
SPEC_TireFlow_v1.md
```

Nenhuma funcionalidade pode ser criada fora da SPEC sem autorização.

---

# Regra 2 — Desenvolvimento por fases

Nunca implemente mais de **uma fase** por vez.

Ao finalizar uma fase:

* Pare.
* Explique o que foi feito.
* Aguarde autorização para continuar.

---

# Regra 3 — Nunca avance sozinho

Nunca implemente funcionalidades futuras.

Exemplo:

Se estou na Fase 2:

❌ Não implemente Fase 3.

---

# Regra 4 — Arquitetura limpa

Sempre respeite a arquitetura definida na SPEC.

Nunca concentre regras de negócio em um único arquivo.

Cada arquivo deve possuir apenas uma responsabilidade.

---

# Regra 5 — Código simples

Priorize:

* Legibilidade.
* Organização.
* Facilidade de manutenção.

Nunca utilize soluções complexas quando existir uma solução simples.

---

# Regra 6 — Explicação obrigatória

Sempre explique:

* arquivos criados;
* pastas criadas;
* bibliotecas utilizadas;
* motivo de cada decisão técnica.

Nunca apenas escreva código.

---

# Regra 7 — Linguagem

Código:

* Inglês.

Mensagens do bot:

* Português.

Comentários:

* Português.

---

# Regra 8 — Não inventar requisitos

Nunca:

* criar comandos novos;
* alterar fluxos;
* modificar regras;
* mudar mensagens.

Sem autorização.

---

# Regra 9 — Segurança

Toda movimentação deve:

* possuir confirmação;
* possuir responsável;
* possuir data;
* possuir hora.

Nunca alterar estoque sem confirmação.

---

# Regra 10 — Consulta nunca prende o bot

O comando:

```
pneu
```

Nunca deve iniciar uma operação obrigatória.

Se o usuário não responder nada:

Nada acontece.

---

# Regra 11 — Operações

Operações como:

* venda
* entrada
* ajuste

Devem:

* permitir cancelar;
* possuir timeout;
* possuir confirmação.

---

# Regra 12 — Organização

Sempre utilizar:

* Services
* Repositories
* Commands
* Utils
* Config
* Database

Evite código duplicado.

---

# Regra 13 — Explicações didáticas

Considere que o desenvolvedor conhece Java e Spring Boot, mas está aprendendo Node.js.

Sempre explique conceitos específicos do ecossistema Node.

---

# Regra 14 — Qualidade

Antes de finalizar uma fase, revise:

* possíveis bugs;
* código duplicado;
* problemas de arquitetura;
* problemas de concorrência.

---

# Regra 15 — Não assumir

Se existir qualquer dúvida sobre a SPEC:

Pare.

Pergunte.

Nunca assuma comportamento.

---

# Regra 16 — Objetivo do projeto

Este projeto será utilizado em uma empresa real.

Toda decisão deve priorizar:

* confiabilidade;
* simplicidade;
* manutenção;
* escalabilidade.

Nunca priorize apenas escrever código rapidamente.
