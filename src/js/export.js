/* ══════════ EXPORT — Exportação de dados ══════════ */

/** Exporta lista de colaboradores como arquivo CSV com BOM UTF-8 */
function exportCSV(){
  const hdr='Nome,Email,Setor,Cargo,Licença Principal,Add-ons,Custo Mensal,Custo Anual,Status,Criado em';
  const rows=db.map(r=>{
    const c=userCost(r);
    const addons=(r.addons||[]).map(a=>getLic(a).short).join('; ');
    return[`"${r.nome}"`,r.email,r.setor,`"${r.cargo}"`,getLic(r.licId).name,addons,
      c>0?c.toFixed(2).replace('.',','):0,c>0?(c*12).toFixed(2).replace('.',','):0,r.status,fmtDate(r.dataISO)].join(',');
  });
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,\uFEFF'+encodeURIComponent(hdr+'\n'+rows.join('\n'));
  a.download='live-m365-'+new Date().toISOString().slice(0,10)+'.csv';a.click();
  toast('CSV exportado!');
}
