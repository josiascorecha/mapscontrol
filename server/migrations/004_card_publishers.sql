-- Nomes que saem no campo PUBLICADORES da ficha para recorte, editáveis por qualquer
-- membro da congregação. Vazio (NULL) = nomes de quem registrou visitas na quadra.

ALTER TABLE blocks ADD COLUMN card_publishers text
  CHECK (card_publishers IS NULL OR char_length(card_publishers) BETWEEN 1 AND 200);
