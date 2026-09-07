from pathlib import Path
p=Path('scripts/apply-operations-reliability-v12.py')
text=p.read_text()
old='''replace_once(\n    "src/lib/field-operations.js",\n    'company: row.company_name || "",\\n    acknowledged:',\n    'company: row.company_name || "",\\n    companyNames: row.company_names || (row.company_name ? [row.company_name] : []),\\n    group: row.group_name || "",\\n    acknowledged:'\n)'''
new='''replace_once(\n    "src/lib/field-operations.js",\n    'staffRole: row.staff_role || "counselor",\\n    company: row.company_name || "",\\n    acknowledged:',\n    'staffRole: row.staff_role || "counselor",\\n    company: row.company_name || "",\\n    companyNames: row.company_names || (row.company_name ? [row.company_name] : []),\\n    group: row.group_name || "",\\n    acknowledged:'\n)'''
if old not in text:
    raise SystemExit('bootstrap target not found')
p.write_text(text.replace(old,new,1))
print('bootstrap retry fix applied')
