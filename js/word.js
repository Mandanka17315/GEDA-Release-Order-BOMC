/* =========================================================================
   Release Order Word (.docx) generation
   – built-in letter (New / Additional load) or the user's mail-merge template
   ========================================================================= */
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function runsFrom(text, base = {}) {
  // **bold**  __italic__
  const out = []; const re = /(\*\*|__)/g; let b = !!base.b, it = !!base.i, last = 0, m;
  const push = s => { if (!s) return; const parts = s.split('\t');
    parts.forEach((p, i) => { if (i) out.push(`<w:r>${rpr(b, it, base)}<w:tab/></w:r>`); if (p) out.push(`<w:r>${rpr(b, it, base)}<w:t xml:space="preserve">${xesc(p)}</w:t></w:r>`); }); };
  while ((m = re.exec(text))) { push(text.slice(last, m.index)); if (m[1] === '**') b = !b; else it = !it; last = m.index + 2; }
  push(text.slice(last)); return out.join('');
}
function rpr(b, i, o) { return `<w:rPr>${b ? '<w:b/><w:bCs/>' : ''}${i ? '<w:i/><w:iCs/>' : ''}${o.u ? '<w:u w:val="single"/>' : ''}${o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : ''}</w:rPr>`; }
function P(text, o = {}) {
  const jc = o.jc || 'both';
  const ind = o.ind ? `<w:ind w:left="${o.ind[0] || 0}" ${o.ind[1] ? `w:hanging="${o.ind[1]}"` : ''} ${o.ind[2] ? `w:firstLine="${o.ind[2]}"` : ''}/>` : '';
  const sp = `<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 100}"/>`;
  const tabs = o.tabs ? `<w:tabs>${o.tabs.map(t => `<w:tab w:val="${t[0]}" w:pos="${t[1]}"/>`).join('')}</w:tabs>` : '';
  return `<w:p><w:pPr>${o.keep ? '<w:keepNext/>' : ''}${tabs}${sp}${ind}<w:jc w:val="${jc}"/></w:pPr>${runsFrom(text, o)}</w:p>`;
}
function cellX(w, content, o = {}) {
  const span = o.span ? `<w:gridSpan w:val="${o.span}"/>` : '';
  const vm = o.vmerge ? `<w:vMerge${o.vmerge === 'restart' ? ' w:val="restart"' : ''}/>` : '';
  const sh = o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>` : '';
  const paras = (Array.isArray(content) ? content : [content]).map(t => P(t, { jc: o.jc || 'left', after: 0, b: o.b })).join('');
  return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span}${vm}${sh}<w:vAlign w:val="center"/></w:tcPr>${paras}</w:tc>`;
}
function TABLE(widths, rows) {
  const b = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, c) => a + c, 0)}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>${b}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="30" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="30" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;
}
const TR = cells => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells.join('')}</w:tr>`;

/** Gather everything the letter needs from the form record */
function roData(v, type) {
  const g = S.geda.get(v.__key) || null;
  const rc = s => { const m = String(s ?? '').trim(); return m === '' ? '0' : m; };
  const pv = numOr(v.pv), ex = numOr(v.ex);
  return {
    type, app: clean(v.app), reg: clean(v.reg), cons: clean(v.cons), name: clean(v.name), cat: clean(v.cat), tariff: clean(v.tariff),
    cl: isNum(v.cl) ? +v.cl : clean(v.cl), msme: clean(v.msme) || '-', sdn: clean(v.sdn), div: clean(v.div), circle: SET.circle,
    pv: fix2(pv), ex: fix2(ex), add: fix2(pv), total: fix2(pv + ex),
    cei: clean(showVal(v.cei)), agr: fmtD(parseDateLoose(v.agr)), roNo: clean(v.roNo), roDate: fmtD(parseDateLoose(v.roDate)),
    pmake: clean(v.pmake), pwatt: clean(v.pwatt), pnos: clean(v.pnos), ptot: clean(v.ptot), imake: clean(v.imake), icap: fix2(v.icap),
    volt: clean(v.volt), isr: clean(v.isr),
    meter: isNum(v.meter) ? +v.meter : clean(v.meter) || 0, meterR: rc(v.meterR), test: isNum(v.test) ? +v.test : clean(v.test) || 0, testR: rc(v.testR),
    conn: isNum(v.conn) ? +v.conn : clean(v.conn) || 0, connR: rc(v.connR), ss: isNum(v.ss) ? +v.ss : clean(v.ss) || 0, ssR: rc(v.ssR),
    policy: clean(v.policy) || SET.policy, general: clean(v.general), eurja: clean(v.eurja), addr: clean(v.addr), village: clean(v.village), taluka: clean(v.taluka),
    installer: clean(v.installer) || clean(gv(g, 'Installer Name')), phase: clean(gv(g, 'Phase of proposed Solar Inverter')),
    seName: SET.seName, seDesig: SET.seDesig
  };
}

function letterBody(D) {
  const add = D.type === 'add';
  const x = [];
  const I1 = [360, 360];       // hanging list
  if (D.roNo || D.roDate) x.push(P(`${D.roNo ? 'No. ' + SET.roPrefix + D.roNo : ''}\tDate: ${D.roDate}`, { jc: 'left', tabs: [['right', 9600]], after: 160 }));
  x.push(P('**To,**', { jc: 'left', after: 0 }));
  if (add) { x.push(P('The Deputy Engineer', { jc: 'left', after: 0 })); x.push(P(`**${D.sdn},**`, { jc: 'left', after: 0 })); }
  else { x.push(P('The Deputy Engineer,', { jc: 'left', after: 0 })); x.push(P(`Subdivision Office, ${D.sdn},`, { jc: 'left', after: 0 })); }
  x.push(P(add ? 'MGVCL' : 'MGVCL.', { jc: 'left', after: 200 }));
  x.push(P(`**Sub:**\t${add ? 'Approval for additional solar load and Grid Connectivity' : 'Approval for Grid Connectivity & Net Metering'} of Solar Roof-Top Photo-Voltaic systems as per provisions under the Gujarat Renewable Energy Policy 2025 in respect of **${D.name}**, **Cons. No. ${D.cons}.**`, { ind: [720, 720], after: 120 }));
  x.push(P(`**Ref:**\t1)\tDy. Director, GEDA letter no. **${D.app}**`, { ind: [1080, 1080], tabs: [['left', 720], ['left', 1080]], after: 0 }));
  x.push(P(`\t2)\tProvisional Connectivity agreement executed by **${D.cons}** with MGVCL. MSME Consumer - **${D.msme}.**`, { ind: [1080, 1080], tabs: [['left', 720], ['left', 1080]], after: add ? 0 : 200 }));
  if (add) {
    x.push(P(`\t3)\tFourth amendment in Net metering regulation, Notification 13 of 2024 Dtd: 06-09-2024.`, { ind: [1080, 1080], tabs: [['left', 720], ['left', 1080]], after: 0 }));
    x.push(P(`\t4)\tGUVNL/COM/Tariff/Net Metering/822 Dtd: 10-07-2022.`, { ind: [1080, 1080], tabs: [['left', 720], ['left', 1080]], after: 200 }));
  }
  if (!add) {
    x.push(P(`With reference to above subject and as per provisional Inter connection Agreement submitted this RO is issued, it is to state that application of **${D.name}** for installation of **${D.pv} KW** Solar Roof-Top Photo-Voltaic system had been registered by GEDA under MSME/Commercial / Gov/ Other category vide registration no. **${D.reg}**.`, { ind: [0, 0, 720] }));
    x.push(P(`Now regarding the connectivity with the MGVCL network for injection of Solar Energy from **${D.pv} KW** Solar Power Plant, consumer bearing consumer no. **${D.cons}** has paid connectivity charges of Rs. **${D.conn}** and executed a provisional connectivity agreement with MGVCL.`, { ind: [0, 0, 720] }));
    x.push(P(`Connectivity has been granted for period of 25 years. Accordingly, the provisional connectivity agreement has been executed for 25 years, and it shall be in force for the period of 25 years only.`, { ind: [0, 0, 720] }));
    x.push(P(`Copy of provisional connectivity agreement, connectivity charge paid receipt, CEI approved single line diagram, earthing diagram, wiring diagram and installation charging approval received from CEI is attached herewith.`, { ind: [0, 0, 720] }));
    x.push(P(`The Solar Power Generator (SPG) shall consume electricity generated from the rooftop solar PV system at the same premise. If consumer is not able to consume all of the generated electricity in the same premise, relevant provisions defined in the **Gujarat Renewable Energy Policy 2025** shall be applicable for surplus energy.`, { ind: [0, 0, 720] }));
    x.push(P(`**The date of meter installation for solar project shall be considered as commissioning date for the project. The commercial settlement shall be in effect from the date of commissioning as under:**`, { ind: [0, 0, 720] }));
    x.push(P(`All the commercial settlements shall be as per Government of Gujarat’s and the subsequent order is to be issued by of the Gujarat Electricity Regulatory Commission in this regard.`, { ind: [0, 0, 720] }));
  } else {
    x.push(P(`With reference to above subject **and as per provisional Inter connection Agreement submitted this RO is issued**, it is to state that application of **${D.name}** bearing consumer no. **${D.cons}** with existing solar capacity **${D.ex} KW** has applied for installation of additional **${D.add} KW** Solar Roof-Top Photo-Voltaic system had been registered by GEDA under **MSME**/**Commercial / Gov/ Other** category vide registration letter as per reference (1).`, { ind: [0, 0, 720] }));
    x.push(P(`**${D.name}** has paid connectivity charges of Rs.${D.conn}/- and executed new grid connectivity agreement for additional solar capacity **${D.add} KW (AC)** with MGVCL.`, { ind: [0, 0, 720] }));
    x.push(P(`In this regard, following steps are to be taken by The Division office:`, { ind: [0, 0, 720] }));
    const L = [
      `The period of agreement for additional Solar Capacity **${D.add} KW (AC)** will be 25 years from the date of new agreement.`,
      `The additional solar load released as per provision of Gujarat Renewable Energy Policy - 2023, as per third amendment of net metering regulation notification 02. 2022, Fourth amendment in Net metering regulation, Notification 13 of 2024 vide ref.(3) and commercial circular issued by GUVNL vide letter at sr. no.4 under reference.`,
      `Now onwards the commercial settlement is to be done as per Energy Accounting and Settlement clause no. 9 (D) of GERC Notification 02 of 2022 **__“in case of any addition in Solar, the earlier set up solar project arrangement shall be consider different and distinct.”__** i.e. the energy settlement of earlier solar project and new solar project is to be done as per the policy under which the project commissioned and agreement executed as per the Guideline issued by GUVNL vide letter at sr. no.4 under reference.`,
      `Copy of grid connectivity agreement, connectivity/system strengthening charge paid receipt, CEI approved single line diagram, earthing diagram, wiring diagram and installation charging approval received from CEI is attached herewith.`,
      `For additional Solar The Solar Power Generator (SPG) shall consume electricity generated from the rooftop solar PV system at the same premise and the energy set off shall be allowed between 07:00 to 18:00hrs of the same day ie. The generated solar energy during the day shall be consumed by the consumer during 07:00 to 18:00hrs of the same day. If consumer is not able to consume all of the generated electricity in the same relevant provisions defined in the Gujarat Renewable Energy Policy - 2023 shall be applicable for surplus energy.`
    ];
    L.forEach((t, i) => x.push(P(`${i + 1}.\t${t}`, { ind: [720, 360] })));
    x.push(P(`The commercial settlement shall be in effect from the date of commissioning as under:`, { ind: [0, 0, 720] }));
  }
  x.push(P(`**Industrial, commercial, Institutional and other consumer MSME (LT, LTMD), Other LTMD consumer)**`, { before: 60 }));
  x.push(P(`A.\tFor LT Consumer the energy accounting shall be on billing cycle basis.`, { ind: I1 }));
  x.push(P(`B.\t**LT demand-based consumers**: The set-off of solar energy shall be allowed between 07.00 hours to 18.00 hours of the same billing cycle basis. That means, the injected solar energy in the grid during a billing cycle shall be set off against consumption of consumers during 07.00 hours to 18.00 hours of the same billing cycle.`, { ind: I1 }));
  x.push(P(`C.\t**LT Other than demand-based consumers**: The energy set-off shall be allowed on billing cycle basis. That means, the generated solar energy during a billing cycle shall be consumed by the consumer during the same billing cycle.`, { ind: I1 }));
  x.push(P(`i.\tThe surplus energy, not consumed by the consumer after set off shall be compensated by the rate; At Rs /unit i.e. 75% of the simple average of tariff discovered and contracted under competitive bidding process conducted by GUVNL For Non- Park based solar projects in the preceding 6-month period, i.e. Either April to September or October to March) as the case may be, from The Commercial operation date (COD) of the project. The same shall Remain fixed for the entire term of the agreement.`, { ind: [720, 360] }));
  x.push(P(`ii.\tExcess drawl by consumer from the grid, if any, after giving set off shall be charged at applicable tariff of respective category of consumer as determined by Hon’ble GERC from time to time.`, { ind: [720, 360] }));
  x.push(P(`iii.\tIn case of projects set up for captive use, no cross- subsidy surcharge and Additional surcharge shall be applicable.`, { ind: [720, 360] }));
  x.push(P(`**Banking Charges:** Banking charge of Rs. 1.50 /Unit on solar energy consumed by consumer, provided that banking charge shall not be applicable in case of Solar Project for Residential building, and Solar project set up for compliance of RPO.`));
  x.push(P(`**Electricity Duty**: As per the provision of Gujarat Electricity Duty Act, 1995`));
  x.push(P(`Consumer file is to be maintained for each point of connectivity (at sub-division for LT level connectivity & at division for HT level connectivity). Moreover, this injected energy (net export) is to be considered as input to the grid, so to be added to the sent-out units worked out from sub-station interface meters for energy accounting and calculation of T & D losses.`, { ind: [0, 0, 720] }));
  x.push(P(`You are instructed to inform field offices to strictly adhere the above instructions.`, { ind: [0, 0, 720] }));
  x.push(P(`The consumer has opted to procure bi-directional meter from MGVCL, has paid meter charges & SMC box charges Rs. **${D.meter}** vide M.R. no. **${D.meterR}**`, { ind: [0, 0, 720] }));
  x.push(P(`You are instructed to depute an Engineer for interconnection, testing and charging of above stated Solar Plant by making necessary arrangements. Above stated bi-directional meter and solar generation meter duly tested lab of MGVCL, is to be installed & sealed for Net Metering (i.e. existing tariff meter is to be replaced and the capacity of solar meter shall be decided in view of the solar installation) and rent of the meter shall be charged from the consumer, accordingly, being property of MGVCL) and submit copy of check sheet to Circle Office.`, { ind: [0, 0, 720] }));
  x.push(P(`Installation of proper protection system (inverter shall have anti-islanding feature) along-with second line of protection such as no-volt relay shall be verified (Solar installations up to 10 KW are exempted from installation of no-volt relay). Report of the same is to be submitted to corporate office.`, { ind: [0, 0, 720] }));
  x.push(P(`Details of the installation for **${D.name} (Reg. no. ${D.reg})** are as under:`, { keep: true, before: 60 }));

  const w = [700, 3300, 5638];
  const rows = [TR([cellX(w[0], '**SR. NO.**', { jc: 'center', shade: 'E7ECF2' }), cellX(w[1], '**ITEM (PARTICULARS)**', { shade: 'E7ECF2' }), cellX(w[2], '**DESCRIPTION**', { shade: 'E7ECF2' })])];
  const R = (n, item, desc) => rows.push(TR([cellX(w[0], String(n), { jc: 'center' }), cellX(w[1], item), cellX(w[2], desc)]));
  R(1, 'GEDA Registration Number', `**${D.reg}**`);
  R(2, 'GEDA reference letter', `**${D.app}**`);
  R(3, 'Consumer No./Contract Load / Category', `**${D.cons}/ ${D.cl} KW/ ${D.cat}**`);
  R(4, 'Name of S/Dn /DN /Circle.', `**${D.sdn}/ ${D.div}/ ${D.circle.replace(/\s*circle\s*$/i, '')}**`);
  R(5, 'Solar Project Capacity', add ? [`**Existing Load : ${D.ex} KW**`, `**Add. Load : ${D.add} KW**`] : `**${D.pv} KW (AC)**`);
  R(6, 'Energy Settlement option Commercial Settlement', add ? '**As per agreement**' : '**As per clause 7,8,9 & 10 of agreement**');
  R(7, 'Connectivity Charges as per GERC order No. 3 of 2015', `**Rs. ${D.conn}** – Paid vide M.R. No. **${D.connR}**`);
  R(8, "Strengthening of DISCOM's System (if any) as per TFR", `**Rs. ${D.ss}** – Paid vide M.R. No. **${D.ssR}**`);
  R(9, 'Chief Electrical Inspector’s / Electrical Inspector’s approval No', `**${D.cei}**`);
  R(10, 'Details of Solar Panel', [`Make of solar panel: **${D.pmake}**`, `Capacity of solar PV cell Modules: **${D.pwatt} Wp**`, `No. of Modules: **${D.pnos}**`, `Total Watt: **${D.ptot} Watt**`]);
  R(11, 'Details of Inverter', [`Make: **${D.imake}**`, `Capacity: **${D.icap} KW**`, `Voltage: **${D.volt} V**`, `Sr. No.: **${D.isr}**`]);
  if (D.installer) R(12, 'Name of Installer', `**${D.installer}**`);
  x.push(TABLE(w, rows));
  x.push(P('', { after: 60 }));
  x.push(P(`Further following steps are to be taken in view of safety for **(Consumer no. ${D.cons} Reg no. ${D.reg}):**`));
  [
    `A register is to be maintained at sub-division stating details of Solar plant. Testing of islanding protection feature of the inverter is to be carried out in the first week of every month by sub-division and same to be entered in the register with name/signature of person confirming the test. Same to be verified by EE/SE during their sub-division visit.`,
    `Circle office to submit above report/certificate to DSM Cell, Corporate Office stating the functionality of inverter by 10th of every month.`,
    `Caution Boards are to be placed immediately on Transformer Center and LT circuit/pole where solar energy is being injected.`,
    `Necessary discussions related to safety issues regarding injection of Solar energy at above stated location is to be carried out in every line staff meeting at concerned sub-division, such as discharging of HT/LT lines before starting any line related work etc.`,
    `Concern village line staff must be specifically shown the installation & make him conversant regarding isolation of power supply while working on the HT/LT line/CTPT etc.`,
    `As per clause no. 13.5, GERC notification 5/2016, check meter is mandatory for solar rooftop PV systems having capacity more than 20 KW, As per CEA, check meter means a meter which shall be connected to the same core of CT/PT as that of the main meter. In case, the consumer does not wish to install the check meter than he has to submit a letter of undertaking that if the only available net meter becomes faulty than no solar energy set-off shall be given by MGVCL till the faulty meter is replaced. MGVCL shall replace the faulty meter with a convectional meter for which average bill, meter rent etc. will be binding to the consumer till the new meter is procured, tested and replaced by the consumer.`
  ].forEach(t => x.push(P(t, { ind: [0, 0, 720] })));
  x.push(P(`You are instructed to inform field offices to strictly adhere the above instructions.`, { ind: [0, 0, 720] }));
  x.push(P(`For your information and necessary action in the matter.`, { ind: [0, 0, 720], after: 500 }));
  x.push(P(`**(${D.seName})**`, { jc: 'right', after: 0, keep: true }));
  x.push(P(`**${D.seDesig}**`, { jc: 'right', after: 0, keep: true }));
  x.push(P(`**${D.circle}**`, { jc: 'right', after: 200 }));
  x.push(P(`**(Encl: All RO Documents along with (i) Net Metering provisional Agreement duly signed by competent authority (ii) Self Certificate /CEI Approval (iii) Approved Drawing & etc to keep in the consumer case file)**`));
  [
    `To confirm payment and to install bi-directional meter and solar generation meter duly tested & sealed at lab of MGVCL, for Net Metering (i.e. existing tariff meter is to be replaced and the capacity of solar meter shall be decided in view of the solar installation and rent of the meter shall be charged from the consumer, accordingly, being property of MGVCL) and submit copy of check sheet to Division office.`,
    `Take Import/Export Kwh reading of Bi-directional meter and solar generation meter as initial reading at the time of meters installed and during Billing cycle and issue bill to consumer on basis of net metering as per commercial settlement clause of Agreement.`,
    `Also keep up-to-date record of Solar Generation & Net Metering at S/Dn level.`,
    `The bi-directional meter should be released within 7 days of this release order. Any delay in release should be brought to notice of this office along with the supporting documents.`,
    `Please verify FQ payment as per contracted load, PV capacity, existing capacity of TC & existing meter installed on site and if find any discrepancies, collect difference amount before release of solar connection.`,
    `Please verify all the data/parameters on site as per self-certification/Electrical inspector NOC i.e. number of SPV panels, capacity & SR. No. of inverter, quantity of earthings, working of no volt relay during failure of power etc. before release of connection.`
  ].forEach(t => x.push(P(`-\t${t}`, { ind: [360, 360] })));
  x.push(P(`**Copy to: The Executive Engineer, ${D.div}**`, { before: 120, jc: 'left' }));
  x.push(P(`(Encl: Copy of all RO Documents along with copy of Net Metering provisional Agreement duly signed by competent authority.)`));
  return x.join('');
}

async function buildBuiltinDocx(D) {
  const z = new JSZip();
  const sz = Math.round(numOr(SET.fontSize, 11) * 2), font = xesc(SET.font || 'Arial');
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  z.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Release Order ${xesc(D.app)}</dc:title><dc:creator>GEDA Release Order - Pendency (A H Mandanka)</dc:creator></cp:coreProperties>`);
  z.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`);
  z.file('word/settings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${W_NS}><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`);
  z.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="en-IN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`);
  const sect = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="900" w:left="1268" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>${letterBody(D)}${sect}</w:body></w:document>`);
  return z.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/* ---------- user template (mail-merge fields and {placeholders}) ---------- */
function mergeValues(v, D) {
  const vals = new Map();
  // every Master column header -> value
  for (const k of ALLKEYS) vals.set(norm(MCOL[k] || EXTRA_COL[k]), v[k] ?? '');
  const ph = {
    application_no: D.app, registration_no: D.reg, consumer_no: D.cons, consumer_name: D.name, category: D.cat, tariff: D.tariff, contract_load: D.cl, msme: D.msme,
    sub_division: D.sdn, division: D.div, circle: D.circle, pv_capacity: D.pv, existing_capacity: D.ex, additional_capacity: D.add, total_capacity: D.total, settlement: D.general,
    meter_smc_charges: D.meter, meter_smc_receipt: D.meterR, testing_charges: D.test, testing_receipt: D.testR, connectivity_charges: D.conn, connectivity_receipt: D.connR,
    ss_charges: D.ss, ss_receipt: D.ssR, cei_approval: D.cei, agreement_date: D.agr, ro_no: D.roNo, ro_date: D.roDate, panel_make: D.pmake, panel_wattage: D.pwatt, modules: D.pnos,
    total_watt: D.ptot, inverter_make: D.imake, inverter_capacity: D.icap, voltage: D.volt, inverter_sr: D.isr, installer_name: D.installer, address: D.addr, village: D.village,
    taluka: D.taluka, eurja_no: D.eurja, phase: D.phase, se_name: D.seName, se_designation: D.seDesig, policy: D.policy
  };
  for (const [k, val] of Object.entries(ph)) { vals.set('{' + k + '}', val); if (!vals.has(norm(k))) vals.set(norm(k), val); }
  return vals;
}
const PH_KEYS = 'application_no registration_no consumer_no consumer_name category tariff contract_load msme sub_division division circle pv_capacity existing_capacity additional_capacity total_capacity settlement meter_smc_charges meter_smc_receipt testing_charges testing_receipt connectivity_charges connectivity_receipt ss_charges ss_receipt cei_approval agreement_date ro_no ro_date panel_make panel_wattage modules total_watt inverter_make inverter_capacity voltage inverter_sr installer_name address village taluka eurja_no phase se_name se_designation policy'.split(' ');

function fmtMerge(val, instr) {
  let s;
  const dm = instr.match(/\\@\s*"([^"]+)"/);
  const nm = instr.match(/\\#\s*"?([0#.,]+)"?/);
  if (isD(val)) {
    s = fmtD(val.d);
    if (dm) { const [y, m, d] = ymdOf(val.d); s = dm[1].replace(/yyyy/i, y).replace(/yy/i, String(y).slice(2)).replace(/MM/, p2(m)).replace(/M/, m).replace(/dd/i, p2(d)).replace(/d/i, d); }
  } else if (nm && isNum(val)) {
    const dec = (nm[1].split('.')[1] || '').length; s = Number(val).toFixed(dec);
  } else s = String(val ?? '');
  if (/\\\*\s*Upper/i.test(instr)) s = s.toUpperCase();
  if (/\\\*\s*Lower/i.test(instr)) s = s.toLowerCase();
  return s;
}
function fillXml(xml, vals, missing) {
  const fieldName = instr => { const m = instr.match(/MERGEFIELD\s+("([^"]+)"|(\S+))/i); return m ? (m[2] || m[3]) : null; };
  const lookup = (name, instr) => { const k = norm(name); if (vals.has(k)) return fmtMerge(vals.get(k), instr); missing.add(name); return '«' + name + '»'; };
  // simple fields
  xml = xml.replace(/<w:fldSimple\b[^>]*w:instr="([^"]*)"[^>]*>([\s\S]*?)<\/w:fldSimple>/g, (m, instr, inner) => {
    instr = decodeXml(instr); const n = fieldName(instr); if (!n) return m;
    const rp = (inner.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
    return `<w:r>${rp}<w:t xml:space="preserve">${xesc(lookup(n, instr))}</w:t></w:r>`;
  });
  // complex fields: begin … instrText … separate … result … end (within one paragraph)
  const tokRe = /<w:r\b[^>]*>[\s\S]*?<\/w:r>|<\/w:p>/g;
  let out = '', pos = 0, m, f = null;
  while ((m = tokRe.exec(xml))) {
    const t = m[0];
    if (t === '</w:p>') { f = null; continue; }
    const fc = (t.match(/w:fldCharType="(\w+)"/) || [])[1];
    if (!f) { if (fc === 'begin') f = { start: m.index, depth: 1, instr: '', sep: false, rpr: (t.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0], rrpr: '' }; continue; }
    if (fc === 'begin') { f.depth++; continue; }
    if (fc === 'separate' && f.depth === 1) { f.sep = true; continue; }
    if (fc === 'end') {
      f.depth--;
      if (f.depth === 0) {
        const name = fieldName(f.instr);
        if (name) { out += xml.slice(pos, f.start) + `<w:r>${f.rrpr || f.rpr}<w:t xml:space="preserve">${xesc(lookup(name, f.instr))}</w:t></w:r>`; pos = m.index + t.length; }
        f = null;
      }
      continue;
    }
    if (f.depth === 1 && !f.sep) { const it = t.match(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/); if (it) f.instr += decodeXml(it[1]); }
    else if (f.depth === 1 && f.sep && !f.rrpr) f.rrpr = (t.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
  }
  xml = out + xml.slice(pos);
  // {placeholders}, tolerant of Word splitting them across runs
  xml = xml.replace(/\{((?:<[^>]+>|[A-Za-z_])+?)\}/g, (m, inner) => {
    const key = inner.replace(/<[^>]+>/g, '');
    if (!vals.has('{' + key.toLowerCase() + '}')) return m;
    const tags = (inner.match(/<[^>]+>/g) || []).join('');
    return xesc(String(vals.get('{' + key.toLowerCase() + '}') ?? '')) + tags;
  });
  return xml;
}
async function buildTemplateDocx(buf, v, D) {
  const z = await JSZip.loadAsync(buf); const vals = mergeValues(v, D); const missing = new Set();
  for (const p of Object.keys(z.files)) {
    if (!/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(p)) continue;
    z.file(p, fillXml(await z.file(p).async('string'), vals, missing));
  }
  // drop the mail-merge data source link so Word does not ask to run a query
  if (z.file('word/settings.xml')) { let s = await z.file('word/settings.xml').async('string'); s = s.replace(/<w:mailMerge>[\s\S]*?<\/w:mailMerge>/, ''); z.file('word/settings.xml', s); }
  if (z.file('word/_rels/settings.xml.rels')) { let s = await z.file('word/_rels/settings.xml.rels').async('string'); s = s.replace(/<Relationship\b[^>]*(mailMergeSource|recipientData|attachedTemplate)[^>]*\/>/g, ''); z.file('word/_rels/settings.xml.rels', s); }
  const blob = await z.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  return { blob, missing: [...missing] };
}

async function makeRO(v, type) {
  const D = roData(v, type);
  const tpl = await KV.get('tpl_' + type);
  let blob, missing = [];
  if (tpl && tpl.buf) ({ blob, missing } = await buildTemplateDocx(tpl.buf, v, D));
  else blob = await buildBuiltinDocx(D);
  const tail = String(D.app).match(/(\d+)\s*$/);
  download(blob, safeName(`RO_${tail ? tail[1] : D.app}_${D.name}${type === 'add' ? '_Additional' : ''}.docx`));
  if (missing.length) toast('Template fields with no matching column: ' + missing.map(esc).join(', '), 'bad', 9000);
}