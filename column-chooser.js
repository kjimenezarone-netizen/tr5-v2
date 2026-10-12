/* Solo modifica la presentación; no altera registros ni esquemas originales. */
const ColumnChooser = {
    states: new Map(),
    visible(key, columns) {
        const hidden = this.states.get(key) || new Set();
        return columns.filter(column => !hidden.has(column));
    },
    toggle(key, columns, column, checked) {
        if (!columns.includes(column)) return;
        const hidden = new Set(this.states.get(key) || []);
        if (checked) hidden.delete(column);
        else {
            if (this.visible(key, columns).length <= 1 && !hidden.has(column)) return;
            hidden.add(column);
        }
        this.states.set(key, hidden);
    },
    reset(key) { this.states.delete(key); },
    mount(id, key, columns, changed) {
        const container = document.getElementById(id);
        const visible = this.visible(key, columns);
        const count = document.createElement('p'); count.textContent = `${visible.length} de ${columns.length} columnas visibles. La exportación conserva todas las columnas.`;
        const all = document.createElement('button'); all.type = 'button'; all.textContent = 'Mostrar todas'; all.className = 'border rounded px-3 py-2'; all.disabled = !columns.length;
        all.addEventListener('click', () => { this.reset(key); changed(); });
        const list = document.createElement('div'); list.className = 'column-options';
        columns.forEach(column => {
            const label = document.createElement('label'), checkbox = document.createElement('input'), text = document.createElement('span');
            checkbox.type = 'checkbox'; checkbox.checked = visible.includes(column);
            checkbox.disabled = checkbox.checked && visible.length === 1;
            text.textContent = column;
            checkbox.addEventListener('change', () => {
                this.toggle(key, columns, column, checkbox.checked); changed();
                const options = container.querySelectorAll('input');
                options[columns.indexOf(column)]?.focus();
            });
            label.append(checkbox, text); list.appendChild(label);
        });
        container.replaceChildren(count, all, list);
    }
};
if (typeof module !== 'undefined' && module.exports) module.exports = ColumnChooser;
