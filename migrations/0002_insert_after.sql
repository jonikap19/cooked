-- Optional anchor for added items: the original row they appear after. NULL = append at the end.
ALTER TABLE adjustments ADD COLUMN insert_after TEXT;
