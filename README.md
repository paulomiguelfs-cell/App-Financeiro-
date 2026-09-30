# Minhas Finanças — controle financeiro pessoal (PWA)

App de controle financeiro para usar no celular, instalável na tela inicial (Android e iPhone), com acesso por senha e dados criptografados no próprio aparelho.

## Funções

- **Login com senha**: os dados ficam criptografados (AES-256) no celular; sem a senha, ninguém lê. Bloqueio automático configurável.
- **Lançamento por texto e voz**: fale ou digite de forma natural, por exemplo:
  - "gastei 45,90 no mercado ontem no Nubank"
  - "comprei um tênis de 600 em 3x no Itaú"
  - "recebi 3.500 do projeto da casa dia 12"

  O app preenche valor, descrição, categoria, forma de pagamento, cartão, parcelas e data. Você confere antes de salvar.
- **Receitas, despesas e saldo mensal.**
- **Cartões de crédito**: limite, dia de fechamento e vencimento, faturas por mês, compras parceladas e marcação de fatura paga.
- **Categorias personalizáveis**: ícone, cor e palavras-chave (ensinam o app a reconhecer a categoria pela voz/texto).
- **Orçamento por categoria**, com alertas em 80% e 100%.
- **Relatórios**: despesas por categoria, receitas × despesas dos últimos 6 meses e gastos por forma de pagamento.
- **Backup**: exportação/importação em JSON e exportação de planilha CSV (Excel).
- Tema escuro e claro; funciona offline.

## Regras importantes

- Compras no **crédito** contam no mês da **fatura** (mês de vencimento). Compras feitas no dia do fechamento ou depois entram na fatura seguinte.
- Os dados **não saem do aparelho**. Se o navegador for limpo ou o celular trocado, só é possível recuperar com um backup exportado.
- A senha **não pode ser recuperada**.

## Como publicar (para usar no celular)

O app precisa ficar em um endereço `https`. Opções gratuitas:

1. **GitHub Pages**: em *Settings → Pages*, escolha *Deploy from a branch*, branch `main`, pasta `/ (root)`.
   Em repositório privado, o GitHub Pages exige plano pago. Como os dados não ficam no repositório, dá para deixá-lo público sem expor informações financeiras.
2. **Netlify** ou **Cloudflare Pages**: conecte o repositório (funciona com repositório privado); não há comando de build e a pasta publicada é a raiz.

### Instalar no celular

- **Android (Chrome)**: abra o endereço → menu ⋮ → *Instalar app*.
- **iPhone (Safari)**: abra o endereço → botão Compartilhar → *Adicionar à Tela de Início*.

## Desenvolvimento

Não há dependências nem etapa de build (HTML, CSS e JavaScript puros).

```bash
npm start   # servidor local em http://localhost:5173
npm test    # testes do interpretador de frases e das regras de fatura
```

Estrutura:

| Arquivo | Função |
|---|---|
| `js/app.js` | Telas, navegação e formulários |
| `js/parser.js` | Interpretação das frases (texto/voz) |
| `js/finance.js` | Regras de faturas, parcelas, resumos e orçamentos |
| `js/vault.js` | Senha e criptografia dos dados |
| `js/voice.js` | Reconhecimento de voz (pt-BR) |
| `js/charts.js` | Gráficos em SVG |
| `sw.js` | Funcionamento offline (altere `VERSION` a cada publicação) |
