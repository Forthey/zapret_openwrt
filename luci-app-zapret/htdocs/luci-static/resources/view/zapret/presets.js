'use strict';
'require fs';
'require uci';
'require ui';
'require view';
'require view.zapret.tools as tools';

document.head.appendChild(E('link', {
    rel: 'stylesheet',
    href: L.resource('view/zapret/styles.css')
}));

const PRESETS_DIR = '/opt/' + tools.appName + '/presets';
const PRESET_SH   = '/opt/' + tools.appName + '/preset.sh';
const ACTIVE_FILE = PRESETS_DIR + '/.active';

const btn_style_action   = 'btn cbi-button-action';
const btn_style_positive = 'btn cbi-button-save important';
const btn_style_warning  = 'btn cbi-button-negative';
const btn_style_neutral  = 'btn';

return view.extend({
    // ---- helpers -------------------------------------------------------

    slugify: function(label)
    {
        let s = (label || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
        return s || 'preset';
    },

    uniqueId: function(base, existingIds)
    {
        let id = base;
        let n = 2;
        while (existingIds.indexOf(id) >= 0) {
            id = base + '-' + n;
            n++;
        }
        return id;
    },

    normalizeOpt: function(s)
    {
        return (s || '').replace(/[\s]+/g, ' ').trim();
    },

    // ---- data loading --------------------------------------------------

    loadPresets: async function()
    {
        let list = await fs.list(PRESETS_DIR).catch(() => []);
        let presets = [];
        for (let i = 0; i < list.length; i++) {
            let e = list[i];
            if (e.type !== 'file' || !/\.json$/.test(e.name)) {
                continue;
            }
            let id = e.name.replace(/\.json$/, '');
            let txt = await fs.read(PRESETS_DIR + '/' + e.name).catch(() => null);
            if (!txt) {
                continue;
            }
            let obj;
            try {
                obj = JSON.parse(txt);
            } catch(e2) {
                console.error('Invalid preset JSON: ' + e.name);
                continue;
            }
            obj.id = id;
            presets.push(obj);
        }
        presets.sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));
        let active = (await fs.read(ACTIVE_FILE).catch(() => '') || '').trim();
        return { presets: presets, active: active };
    },

    load: function()
    {
        return Promise.all([
            this.loadPresets(),
            uci.load(tools.appName),
        ]).then(res => res[0]);
    },

    // ---- mutations -----------------------------------------------------

    writePreset: function(id, obj)
    {
        return fs.write(PRESETS_DIR + '/' + id + '.json', JSON.stringify(obj, null, 2) + '\n');
    },

    deletePreset: async function(preset)
    {
        if (!confirm(_('Delete preset "%s"?').format(preset.label || preset.id))) {
            return;
        }
        try {
            await fs.remove(PRESETS_DIR + '/' + preset.id + '.json');
        } catch(e) {
            ui.addNotification(null, E('p', _('Failed to delete preset: %s').format(e)));
        }
        return this.refresh();
    },

    activatePreset: async function(preset)
    {
        if (tools.checkUnsavedChanges && tools.checkUnsavedChanges()) {
            ui.addNotification(null, E('p', _('You have unapplied changes')));
            return;
        }
        ui.showModal(_('Activating preset'), [
            E('p', { 'class': 'spinning' }, _('Applying preset "%s" and restarting service…').format(preset.label || preset.id))
        ]);
        try {
            let res = await fs.exec(PRESET_SH, [ 'activate', preset.id ]);
            ui.hideModal();
            if (res.code !== 0) {
                ui.addNotification(null, E('p', _('Activation failed (code %d): %s').format(res.code, (res.stdout || res.stderr || '').trim())));
            } else {
                ui.addNotification(null, E('p', _('Preset "%s" activated').format(preset.label || preset.id)), 'info');
            }
        } catch(e) {
            ui.hideModal();
            ui.addNotification(null, E('p', _('Activation error: %s').format(e)));
        }
        return this.refresh();
    },

    // ---- add / edit dialog ---------------------------------------------

    editDialog: function(preset)
    {
        let isNew = !preset;
        let p = preset || { label: '', nfqws_opt: '', ports_tcp: '80,443', ports_udp: '443', source: 'manual' };

        let in_label = E('input', { type: 'text', class: 'cbi-input-text', style: 'width:100%', value: p.label || '' });
        let in_tcp   = E('input', { type: 'text', class: 'cbi-input-text', style: 'width:100%', value: p.ports_tcp || '' });
        let in_udp   = E('input', { type: 'text', class: 'cbi-input-text', style: 'width:100%', value: p.ports_udp || '' });
        let in_opt   = E('textarea', {
            class: 'cbi-input-textarea',
            style: 'width:100%; font-family:monospace;',
            rows: 16, wrap: 'off',
        }, p.nfqws_opt || '');

        let row = (title, widget, hint) => E('div', { class: 'cbi-value' }, [
            E('label', { class: 'cbi-value-title' }, title),
            E('div', { class: 'cbi-value-field' }, [ widget, hint ? E('div', { class: 'cbi-value-description' }, hint) : '' ]),
        ]);

        let src_note = (!isNew && p.source && p.source !== 'manual')
            ? E('div', { class: 'cbi-value-description' },
                _('Source: %s').format(p.source) + (p.rel_tag ? (' · ' + p.rel_tag) : '') + (p.strategy_name ? (' · ' + p.strategy_name) : ''))
            : '';

        let save_btn = E('button', { class: btn_style_positive }, isNew ? _('Create') : _('Save'));
        save_btn.onclick = ui.createHandlerFn(this, async () => {
            let label = in_label.value.trim();
            let opt   = in_opt.value.trim();
            if (!label) {
                ui.addNotification(null, E('p', _('Label is required')));
                return;
            }
            if (!opt) {
                ui.addNotification(null, E('p', _('NFQWS options are required')));
                return;
            }
            let id;
            if (isNew) {
                let data = await this.loadPresets();
                let existing = data.presets.map(x => x.id);
                id = this.uniqueId(this.slugify(label), existing);
            } else {
                id = p.id;
            }
            let obj = {
                label: label,
                nfqws_opt: opt,
                ports_tcp: in_tcp.value.trim(),
                ports_udp: in_udp.value.trim(),
                source: p.source || 'manual',
                rel_tag: p.rel_tag || '',
                strategy_name: p.strategy_name || '',
            };
            try {
                await this.writePreset(id, obj);
            } catch(e) {
                ui.addNotification(null, E('p', _('Failed to save preset: %s').format(e)));
                return;
            }
            ui.hideModal();
            return this.refresh();
        });

        let cancel_btn = E('button', { class: btn_style_warning }, _('Cancel'));
        cancel_btn.onclick = ui.hideModal;

        ui.showModal(isNew ? _('Add preset') : _('Edit preset'), [
            E('div', { class: 'cbi-section' }, [
                row(_('Label'), in_label),
                row(_('TCP ports'), in_tcp, _('Maps to NFQWS_PORTS_TCP')),
                row(_('UDP ports'), in_udp, _('Maps to NFQWS_PORTS_UDP')),
                row(_('NFQWS options'), in_opt,
                    _('One nfqws option per line. Maps to NFQWS_OPT. Use full paths, e.g. /opt/zapret/files/fake/…')),
                src_note,
            ]),
            E('div', { style: 'display:flex; justify-content:space-between; margin-top:10px;' }, [
                E('div', {}, [ save_btn ]),
                E('div', {}, [ cancel_btn ]),
            ]),
        ]);
    },

    // ---- rendering -----------------------------------------------------

    buildTable: function(data)
    {
        let active = data.active;
        let activeObj = data.presets.filter(p => p.id === active)[0];

        // drift detection: compare live NFQWS_OPT with the active preset
        let drift = '';
        if (activeObj) {
            let live = uci.get(tools.appName, 'config', 'NFQWS_OPT') || '';
            if (this.normalizeOpt(live) !== this.normalizeOpt(activeObj.nfqws_opt)) {
                drift = E('div', { class: 'alert-message warning' },
                    _('The live NFQWS_OPT differs from the active preset "%s" (edited manually in Settings). Re-activate the preset to sync, or update the preset.').format(activeObj.label || activeObj.id));
            }
        }

        let rows = [];
        rows.push(E('tr', { class: 'tr table-titles' }, [
            E('th', { class: 'th' }, _('Active')),
            E('th', { class: 'th' }, _('Label')),
            E('th', { class: 'th' }, _('Source')),
            E('th', { class: 'th' }, _('Ports (TCP / UDP)')),
            E('th', { class: 'th', style: 'text-align:right' }, _('Actions')),
        ]));

        if (data.presets.length === 0) {
            rows.push(E('tr', { class: 'tr' }, [
                E('td', { class: 'td', colspan: 5 }, E('em', {}, _('No presets yet. Click "Add preset" to create one.')))
            ]));
        }

        for (let i = 0; i < data.presets.length; i++) {
            let p = data.presets[i];
            let is_active = (p.id === active);

            let act_btn = E('button', { class: is_active ? btn_style_neutral : btn_style_action }, is_active ? _('Active') : _('Activate'));
            act_btn.disabled = is_active;
            act_btn.onclick = ui.createHandlerFn(this, () => this.activatePreset(p));

            let edit_btn = E('button', { class: btn_style_neutral }, _('Edit'));
            edit_btn.onclick = () => this.editDialog(p);

            let del_btn = E('button', { class: btn_style_warning }, _('Delete'));
            del_btn.onclick = ui.createHandlerFn(this, () => this.deletePreset(p));

            let src = p.source || 'manual';
            if (src === 'flowseal' && (p.rel_tag || p.strategy_name)) {
                src = 'flowseal (' + [ p.rel_tag, p.strategy_name ].filter(Boolean).join(' / ') + ')';
            }

            rows.push(E('tr', { class: 'tr' + (is_active ? ' cbi-rowstyle-active' : '') }, [
                E('td', { class: 'td' }, is_active ? '✓' : ''),
                E('td', { class: 'td' }, E('strong', {}, p.label || p.id)),
                E('td', { class: 'td' }, src),
                E('td', { class: 'td' }, (p.ports_tcp || '-') + ' / ' + (p.ports_udp || '-')),
                E('td', { class: 'td', style: 'text-align:right; white-space:nowrap' }, [ act_btn, ' ', edit_btn, ' ', del_btn ]),
            ]));
        }

        let table = E('table', { class: 'table cbi-section-table' }, rows);
        return E('div', {}, [ drift, table ]);
    },

    refresh: function()
    {
        return this.loadPresets().then(data => {
            let node = this.buildTable(data);
            this.container.innerHTML = '';
            this.container.appendChild(node);
        });
    },

    render: function(data)
    {
        if (!data) {
            return;
        }
        this.container = E('div', { class: 'cbi-section-node' });
        this.container.appendChild(this.buildTable(data));

        let add_btn = E('button', { class: btn_style_positive }, _('Add preset'));
        add_btn.onclick = () => this.editDialog(null);

        return E([
            E('h2', { class: 'fade-in' }, tools.AppName + ' - ' + _('Presets')),
            E('div', { class: 'cbi-section-descr fade-in' },
                _('Manage multiple nfqws strategies. Activating a preset copies its options into the running configuration and restarts the service.')),
            E('div', { class: 'cbi-section fade-in' }, [
                E('div', { style: 'margin-bottom:10px;' }, [ add_btn ]),
                this.container,
            ]),
        ]);
    },

    handleSave     : null,
    handleSaveApply: null,
    handleReset    : null,
});
