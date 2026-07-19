let claimsData = [],
    generatedData = [],
    currentData = [],
    level = 0,
    selected = {};

// LOGIN

function login() {
    const u = username.value;
    const p = password.value;

    if (!USERS.find(x => x.username === u && x.password === p)) {
        alert("Invalid");
        return;
    }

    document.getElementById("login-container").style.display = "none";
    document.getElementById("dashboard").style.display = "flex";

    loadData();
}


// LOGOUT

function logout() {
    location.reload();
}


// LOAD DATA

async function loadData() {

    claimsData = await fetchAllRecords(
        CONFIG.CLAIMS_BASE_ID,
        CONFIG.CLAIMS_TABLE,
        CONFIG.CLAIMS_VIEW
    );

    generatedData = await fetchAllRecords(
        CONFIG.GENERATED_BASE_ID,
        CONFIG.GENERATED_TABLE,
        CONFIG.GENERATED_VIEW
    );

    showPage('summary');
}


// SHOW MENU PAGE

function showPage(p) {

    window.currentPage = p;
    level = 0;
    selected = {};

    document.getElementById('backBtn').style.display = 'none';
    document.getElementById('breadcrumb').innerHTML = '';

    const titles = {

        summary: "Dashboard Summary",
        claims: "Coupon Claims Received",
        rsmApproved: "RSM Approved",
        pendingRSM: "Pending at RSM",
        hoApproved: "HO Approved",
        pendingHO: "Pending at HO",
        generated: "Coupons Generated - RSM Wise",
        generatedASM: "Coupons Generated - ASM Wise",
        generatedDSA: "Coupons Generated - DSA Wise"

    };

    pageTitle.innerText = titles[p] || "";


    if (p === 'summary') {

        summary();
        return;

    }


    if (p === 'claims') {

        currentData = claimsData;

    }

    else if (p === 'rsmApproved') {

        currentData = claimsData.filter(
            r => r.fields.RSM_APPROVAL === 'Approved'
        );

    }

    else if (p === 'pendingRSM') {

        currentData = claimsData.filter(
            r => r.fields.RSM_APPROVAL === 'Pending'
        );

    }

    else if (p === 'hoApproved') {

        currentData = claimsData.filter(
            r => r.fields.HO_APPROVAL === 'Approved'
        );

    }

    else if (p === 'pendingHO') {

        currentData = claimsData.filter(
            r => r.fields.HO_APPROVAL === 'Pending'
        );

    }

    else {

        currentData = generatedData;

    }

    if(p==='generatedASM'){currentData=generatedData;showASM();return;}
    if(p==='generatedDSA'){currentData=generatedData;showDSA();return;}

    showRSM();

}


// DASHBOARD SUMMARY

function summary() {

    contentArea.innerHTML = `

    <p>Total Claims: ${claimsData.length}</p>

    <p>RSM Approved: ${
        claimsData.filter(
            r => r.fields.RSM_APPROVAL === 'Approved'
        ).length
    }</p>

    <p>Pending at RSM: ${
        claimsData.filter(
            r => r.fields.RSM_APPROVAL === 'Pending'
        ).length
    }</p>

    <p>HO Approved: ${
        claimsData.filter(
            r => r.fields.HO_APPROVAL === 'Approved'
        ).length
    }</p>

    <p>Pending at HO: ${
        claimsData.filter(
            r => r.fields.HO_APPROVAL === 'Pending'
        ).length
    }</p>

    <p>Total Coupons Generated: ${generatedData.length}</p>

    `;

}


// GROUP DATA

function group(data, key) {

    let obj = {};

    data.forEach(r => {

        let value = r.fields[key] || 'Blank';

        obj[value] = (obj[value] || 0) + 1;

    });

    return obj;

}


// RENDER TABLE

function render(grouped, cb, heading) {

    let h = `

    <button onclick="downloadTableExcel('${heading}.xlsx')">
    Download Excel
    </button>

    <br><br>

    <table>

    <tr>
    <th>${heading}</th>
    <th>Count</th>
    </tr>

    `;

    Object.entries(grouped).forEach(([k, v]) => {

        h += `
        <tr onclick="${cb}('${k.replace(/'/g, "")}')">
        <td>${k}</td>
        <td>${v}</td>
        </tr>
        `;

    });

    h += "</table>";

    contentArea.innerHTML = h;

}


// SHOW RSM

function showRSM() {

    render(
        group(currentData, 'RSM_HQ'),
        'selectRSM',
        'RSM_HQ'
    );

}



function showASM(){level=0;render(group(currentData,'ASM_HQ'),'selectASMFromMenu','ASM_HQ');}
function selectASMFromMenu(v){selected.asm=v;level=2;backBtn.style.display="inline";updateBreadcrumb();let data=currentData.filter(r=>(r.fields.ASM_HQ||'Blank')===v);render(group(data,'DSA_HQ'),'selectDSAFromASMMenu','DSA_HQ');}
function selectDSAFromASMMenu(v){selected.dsa=v;level=3;updateBreadcrumb();let data=currentData.filter(r=>(r.fields.ASM_HQ||'Blank')===selected.asm&&(r.fields.DSA_HQ||'Blank')===v);let h=`<button onclick="downloadTableExcel('Coupon_Report.xlsx')">Download Excel</button><table><tr><th>DATE</th><th>CUSTOMER_NAME</th><th>CERT_NO</th></tr>`;data.forEach(r=>{let f=r.fields;h+=`<tr><td>${f.DATE||''}</td><td>${f.CUSTOMER_NAME||''}</td><td>${f.CERT_NO||''}</td></tr>`});h+='</table>';contentArea.innerHTML=h;}
function showDSA(){level=0;render(group(currentData,'DSA_HQ'),'selectDSAFromMenu','DSA_HQ');}
function selectDSAFromMenu(v){selected.dsa=v;level=3;backBtn.style.display="inline";updateBreadcrumb();let data=currentData.filter(r=>(r.fields.DSA_HQ||'Blank')===v);let h=`<button onclick="downloadTableExcel('Coupon_Report.xlsx')">Download Excel</button><table><tr><th>DATE</th><th>CUSTOMER_NAME</th><th>CERT_NO</th></tr>`;data.forEach(r=>{let f=r.fields;h+=`<tr><td>${f.DATE||''}</td><td>${f.CUSTOMER_NAME||''}</td><td>${f.CERT_NO||''}</td></tr>`});h+='</table>';contentArea.innerHTML=h;}
// SELECT RSM

function selectRSM(v) {

    selected.rsm = v;

    level = 1;

    backBtn.style.display = "inline";

    updateBreadcrumb();

    render(

        group(

            currentData.filter(
                r => (r.fields.RSM_HQ || 'Blank') === v
            ),

            'ASM_HQ'

        ),

        'selectASM',
        'ASM_HQ'

    );

}


// SELECT ASM

function selectASM(v) {

    selected.asm = v;

    level = 2;

    updateBreadcrumb();

    let data = currentData.filter(

        r =>

        (r.fields.RSM_HQ || 'Blank') === selected.rsm &&
        (r.fields.ASM_HQ || 'Blank') === v

    );

    render(

        group(data, 'DSA_HQ'),
        'selectDSA',
        'DSA_HQ'

    );

}


// SELECT DSA

function selectDSA(v) {

    selected.dsa = v;

    level = 3;

    updateBreadcrumb();

    let data = currentData.filter(

        r =>

        (r.fields.RSM_HQ || 'Blank') === selected.rsm &&
        (r.fields.ASM_HQ || 'Blank') === selected.asm &&
        (r.fields.DSA_HQ || 'Blank') === v

    );

    let h = `

    <button onclick="downloadTableExcel('Coupon_Report.xlsx')">
    Download Excel
    </button>

    <br><br>

    <table>

    <tr>
    <th>DATE</th>
    <th>CUSTOMER_NAME</th>
    <th>CERT_NO</th>
    </tr>

    `;


    data.forEach(r => {

        let f = r.fields;

        h += `

        <tr>

        <td>${f.DATE || ''}</td>
        <td>${f.CUSTOMER_NAME || ''}</td>
        <td>${f.CERT_NO || ''}</td>

        </tr>

        `;

    });

    h += "</table>";

    contentArea.innerHTML = h;

}


// BACK BUTTON

function goBack() {

    if (level === 3) {

        selectASM(selected.asm);
        level = 2;

    }

    else if (level === 2) {

        selectRSM(selected.rsm);
        level = 1;

    }

    else {

        level = 0;

        backBtn.style.display = 'none';

        showRSM();

        selected = {};

        breadcrumb.innerHTML = '';

    }

}


// BREADCRUMB

function updateBreadcrumb() {

    breadcrumb.innerText =
        `${selected.rsm || ''} ${selected.asm || ''} ${selected.dsa || ''}`;

}


// DOWNLOAD EXCEL

function downloadTableExcel(filename = 'Report.xlsx') {

    let table = document.querySelector('#contentArea table');

    if (!table) {

        alert("No table found.");
        return;

    }

    let workbook = XLSX.utils.table_to_book(table, {

        sheet: "Report"

    });

    XLSX.writeFile(workbook, filename);

}