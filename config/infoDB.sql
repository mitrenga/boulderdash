SELECT `ndx`, `name`, `score`, `created`
FROM `rg_bd_hallOfFame`
ORDER BY `ndx` DESC
LIMIT :limit
