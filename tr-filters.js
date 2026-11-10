const TRFilters = {
    text(value) { return String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); },
    // Normalización de comparación: texto, tildes y mayúsculas sin cambiar datos originales.
    occupationColumns(dataset) {
        if (!dataset?.columns) return [];
        return dataset.columns.filter(column => {
            const name = this.text(column.rawHeader || column.label).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
            return /^(OCUPACION|OFICIO|PUESTO|CARGO)(?: |$)/.test(name)
                || /^(DENOMINACION DEL PUESTO|PUESTO DE TRABAJO)$/.test(name);
        });
    },
    workerOccupations(person) {
        const values = [];
        for (const type of ['TR5', 'TR6']) {
            for (const item of person[type] || []) {
                for (const column of this.occupationColumns(item.dataset)) {
                    const occupation = (item.record.rawCells[column.index] ?? '').trim();
                    if (occupation) values.push(occupation);
                }
            }
        }
        return values;
    },
    documentTypes(analysis) {
        const types = new Map();
        for (const person of analysis.people) {
            const value = String(person.type ?? '').trim();
            if (value && !types.has(this.text(value))) types.set(this.text(value), value);
        }
        return [...types.values()].sort((a,b) => a.localeCompare(b,'es'));
    },
    occupations(analysis) {
        const values = new Map();
        for (const person of analysis.people) {
            for (const value of this.workerOccupations(person)) {
                if (!values.has(this.text(value))) values.set(this.text(value), value);
            }
        }
        return [...values.values()].sort((a,b) => a.localeCompare(b,'es'));
    },
    searchableFields(analysis) {
        const defaults = [
            { value: 'all', label: 'Todos los campos' },
            { value: 'surname', label: 'Apellido paterno o materno' },
            { value: 'names', label: 'Nombres' },
            { value: 'document', label: 'Tipo o número de documento' },
            { value: 'occupation', label: 'Oficio u ocupación' }
        ];
        const extra = analysis.datasets.flatMap(dataset => dataset.columns.map(column => ({
            value: `raw:${dataset.type}:${column.index}`,
            label: `${dataset.type} · ${column.label}`
        })));
        return [...defaults, ...extra];
    },
    matchesWorker(person, { query = '', field = 'all', documentType = '', occupation = '' } = {}) {
        if (documentType && this.text(person.type) !== this.text(documentType)) return false;
        if (occupation && !this.workerOccupations(person).some(value => this.text(value) === this.text(occupation))) return false;
        const wanted = this.text(query);
        if (!wanted) return true;
        const allItems = [...(person.TR5 || []), ...(person.TR6 || [])];
        let values = [];
        if (field === 'surname') values = allItems.flatMap(item => (item.names || []).slice(0,2));
        else if (field === 'names') values = allItems.map(item => item.names?.[2] ?? '');
        else if (field === 'document') values = [person.type, person.number];
        else if (field === 'occupation') values = this.workerOccupations(person);
        else if (/^raw:TR[56]:\d+$/.test(field)) {
            const [, type, indexText] = /^raw:(TR[56]):(\d+)$/.exec(field);
            const index = Number(indexText);
            values = (person[type] || []).map(item => item.record.rawCells[index]).filter(v => v !== undefined);
        } else if (field === 'all') {
            values = [person.type, person.number, ...(person.names || []),
                ...allItems.flatMap(item => item.record.rawCells)];
        } else return false;
        return values.some(value => this.text(value).includes(wanted));
    },
    matches(person, rules, parseDate) {
        return ['TR5', 'TR6'].every(type => {
            const conditions = rules.filter(r => r.type === type);
            if (!conditions.length) return true;
            return person[type].some(({record}) => conditions.every(rule => {
                const original = record.rawCells[rule.index];
                if (original === undefined) return false;
                const value = this.text(original), expected = this.text(rule.value);
                if (rule.operator === 'empty') return value === '';
                if (rule.operator === 'notEmpty') return value !== '';
                if (rule.operator === 'contains') return value.includes(expected);
                if (rule.operator === 'equals') return value === expected;
                if (rule.operator === 'notEquals') return value !== expected;
                if (rule.operator === 'starts') return value.startsWith(expected);
                const date = parseDate(original).iso;
                if (!date) return false;
                if (rule.operator === 'from') return date >= rule.value;
                if (rule.operator === 'to') return date <= rule.value;
                if (rule.operator === 'dateEquals') return date === rule.value;
                if (rule.operator === 'between') return date >= rule.value && date <= rule.end;
                return false;
            }));
        });
    }
};
if (typeof module !== 'undefined' && module.exports) module.exports = TRFilters;

const TRFilterUI = {
    rules: [], fields: [],
    reset() { this.rules = []; this.fields = []; this.draw(); document.getElementById('tr-filter-field').replaceChildren(); },
    set(analysis) {
        this.reset();
        this.fields = analysis.datasets.flatMap(d => d.columns.map(c => ({type:d.type,index:c.index,label:`${d.type} · ${c.label} (columna ${c.index+1})`})));
        document.getElementById('tr-filter-field').replaceChildren(...this.fields.map((field,i) => { const option=document.createElement('option');option.value=String(i);option.textContent=field.label;return option; }));
    },
    descriptions() {
        const labels={contains:'contiene',equals:'igual a',notEquals:'distinto de',starts:'empieza por',empty:'vacío',notEmpty:'con información',from:'desde',to:'hasta',between:'entre',dateEquals:'fecha igual a'};
        return this.rules.map(r=>`${r.label}: ${labels[r.operator]} ${r.value}${r.end ? ` y ${r.end}` : ''}`);
    },
    draw() {
        const list=document.getElementById('tr-active-filters');
        list.replaceChildren(...this.descriptions().map((description,i)=>{
            const li=document.createElement('li');
            li.className='filter-chip-item';
            const label = document.createElement('span');
            label.className = 'filter-chip-label';
            label.textContent = description; // Datos TXT nunca se insertan como HTML.
            li.appendChild(label);
            const button=document.createElement('button');
            button.innerHTML='&times;';
            button.className='filter-chip-remove';
            button.title=`Quitar filtro: ${description}`;
            button.setAttribute('aria-label',`Quitar filtro ${description}`);
            button.addEventListener('click',()=>{this.rules.splice(i,1);this.changed();});
            li.appendChild(button);
            return li;
        }));
        document.getElementById('tr-filter-count').textContent=this.rules.length
            ? `${this.rules.length} filtro${this.rules.length>1?'s':''} activo${this.rules.length>1?'s':''}`
            : '';
        // Sincronizar el desplegable de exportación dinámico
        if(typeof TRExport!=='undefined') TRExport.syncScopeOptions();
    },
    changed() { this.draw(); TRExport.invalidate(); TRView.page=0; TRView.render(); },
    controls() {
        const op=document.getElementById('tr-filter-operator').value;
        const valueWrap=document.getElementById('tr-filter-value-wrap');
        const endWrap=document.getElementById('tr-filter-end-wrap');
        const value=document.getElementById('tr-filter-value');
        const end=document.getElementById('tr-filter-end');

        const isDateOp=['from','to','between','dateEquals'].includes(op);
        const isNoValueOp=['empty','notEmpty'].includes(op);
        const isBetween=op==='between';

        // Tipo de input de valor
        value.type=isDateOp?'date':'text';

        // Ocultar campo valor si no aplica
        if(valueWrap) valueWrap.classList.toggle('hidden', isNoValueOp);
        value.disabled=isNoValueOp;

        // Mostrar campo "hasta" solo para "entre"
        if(endWrap) endWrap.classList.toggle('hidden', !isBetween);
        end.disabled=!isBetween;
    },
    add() {
        const el=id=>document.getElementById(id),field=this.fields[Number(el('tr-filter-field').value)];
        if(!field || !TRView.analysis) return;
        const operator=el('tr-filter-operator').value,empty=['empty','notEmpty'].includes(operator),value=empty?'':el('tr-filter-value').value.trim(),end=operator==='between'?el('tr-filter-end').value:'';
        if(!empty && !value) return Utils.showToast('Ingrese un valor para el filtro.','info');
        if(['from','to','between','dateEquals'].includes(operator) && (!TRAnalysis.date(value).iso || (operator==='between' && (!TRAnalysis.date(end).iso || value>end)))) return Utils.showToast('Ingrese fechas válidas y un intervalo en orden.','info');
        if (this.rules.some(r => r.type === field.type && r.index === field.index && r.operator === operator && r.value === value && r.end === end)) {
            return Utils.showToast('Este filtro ya está aplicado.', 'info');
        }
        this.rules.push({...field,operator,value,end});this.changed();
    }
};
if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('tr-filter-add').addEventListener('click',()=>TRFilterUI.add());
    document.getElementById('tr-filter-clear').addEventListener('click',()=>{TRFilterUI.rules=[];TRFilterUI.changed();});
    document.getElementById('tr-filter-operator').addEventListener('change',()=>TRFilterUI.controls());
    TRFilterUI.controls();TRFilterUI.draw();
});
