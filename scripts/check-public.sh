#!/usr/bin/env bash
# Critério 13 — impede publicar dados reais ou segredos no repositório.
# Verifica os arquivos que iriam para o Git (rastreados + novos não ignorados).
# Termos privados adicionais (nomes, e-mails, congregações reais) podem ser listados,
# um por linha, em deploy/private/termos-proibidos.txt — arquivo ignorado pelo Git.
set -uo pipefail
cd "$(dirname "$0")/.."
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  mapfile -t FILES < <(git ls-files -co --exclude-standard | grep -vE '\.(png|jpg|jar|ico)$')
else
  mapfile -t FILES < <(find . -type f -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path './.git/*' | grep -vE '\.(png|jpg|jar|ico)$')
fi
fail=0
report() { echo "✗ $1"; echo "$2" | head -5 | sed 's/^/    /'; fail=1; }

# 1. Arquivos que nunca devem ser publicados
bad=$(printf '%s\n' "${FILES[@]}" | grep -E '(^|/)\.env$|\.dump$|\.jks$|\.keystore$|\.pem$|(^|/)private/|(^|/)backups/' || true)
[ -z "$bad" ] || report "arquivos proibidos no repositório" "$bad"

# 2. Chaves privadas e tokens
hits=$(grep -nE -- '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}' "${FILES[@]}" 2>/dev/null || true)
[ -z "$hits" ] || report "possível chave/token" "$hits"

# 3. E-mails fora de domínios de exemplo
hits=$(grep -noE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "${FILES[@]}" 2>/dev/null \
  | grep -vE '@(exemplo\.(test|com\.br|com)|example\.(com|org)|noreply\.github\.com|anthropic\.com)$' \
  | grep -vE '@(vitejs|types|node-rs|fastify|playwright|testing-library)/|@maps\.app\.goo\.gl' || true)
[ -z "$hits" ] || report "e-mail real encontrado" "$hits"

# 4. Links curtos reais do Google Maps (nos exemplos use EXEMPLO…)
hits=$(grep -noE 'maps\.app\.goo\.gl/[A-Za-z0-9]{6,}' "${FILES[@]}" 2>/dev/null | grep -vE 'goo\.gl/(EXEMPLO|AbC123|x$|y$|p$|q$|Z$)' || true)
[ -z "$hits" ] || report "link do Google Maps que parece real" "$hits"

# 5. Valores de segredo preenchidos em arquivos de exemplo
hits=$(grep -nE '^(POSTGRES_PASSWORD|CODE_PEPPER|SMTP_PASS)=' deploy/.env.example | grep -vE '=(troque|senha$)' || true)
[ -z "$hits" ] || report ".env.example com valor real" "$hits"

# 6. Termos privados definidos localmente
if [ -f deploy/private/termos-proibidos.txt ]; then
  while IFS= read -r term; do
    [ -z "$term" ] && continue
    hits=$(grep -nFi -- "$term" "${FILES[@]}" 2>/dev/null || true)
    [ -z "$hits" ] || report "termo privado encontrado" "$(echo "$hits" | cut -d: -f1,2)"
  done < deploy/private/termos-proibidos.txt
fi

if [ $fail -eq 0 ]; then echo "✓ Nenhum dado privado ou segredo encontrado em ${#FILES[@]} arquivos."; fi
exit $fail
