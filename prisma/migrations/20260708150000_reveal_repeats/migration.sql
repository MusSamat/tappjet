-- Early stage: every «Позвонить» tap is a row (repeat reveals count).
DROP INDEX "contact_reveals_viewer_id_context_type_context_id_key";
CREATE INDEX "contact_reveals_viewer_id_context_type_context_id_idx"
  ON "contact_reveals"("viewer_id", "context_type", "context_id");
