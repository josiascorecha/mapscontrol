-- Publicadores também cadastram territórios e quadras. O que um publicador cadastra
-- fica "aguardando confirmação" até um administrador confirmar; enquanto isso, quem
-- cadastrou pode excluir. Depois de confirmado, publicadores só podem editar.

ALTER TABLE territories ADD COLUMN created_by uuid REFERENCES users(id);
ALTER TABLE territories ADD COLUMN confirmed_at timestamptz;
ALTER TABLE territories ADD COLUMN confirmed_by uuid REFERENCES users(id);

ALTER TABLE blocks ADD COLUMN created_by uuid REFERENCES users(id);
ALTER TABLE blocks ADD COLUMN confirmed_at timestamptz;
ALTER TABLE blocks ADD COLUMN confirmed_by uuid REFERENCES users(id);

-- Tudo o que já existia foi cadastrado por administradores: conta como confirmado.
UPDATE territories SET confirmed_at = created_at WHERE confirmed_at IS NULL;
UPDATE blocks SET confirmed_at = created_at WHERE confirmed_at IS NULL;

CREATE INDEX territories_pending_idx ON territories(congregation_id) WHERE confirmed_at IS NULL;
CREATE INDEX blocks_pending_idx ON blocks(congregation_id) WHERE confirmed_at IS NULL;
