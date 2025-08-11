(() => {
  const application = window.Stimulus.Application.start();
  application.register('selection', class extends Stimulus.Controller {
    static get targets() { return ['officeSelect']; }

    connect() { this.populateOffices(); }

    async populateOffices() {
      try {
        const res = await fetch('/.netlify/functions/listOffices');
        const { offices } = await res.json();
        this.officeSelectTarget.innerHTML = '';
        for (const off of offices) {
          const opt = document.createElement('option');
          opt.value = off; opt.textContent = off;
          this.officeSelectTarget.appendChild(opt);
        }
      } catch (e) {
        alert('Failed to load offices: ' + e.message);
      }
    }

    loadSelected() {
      const office = this.officeSelectTarget.value;
      if (!office) { alert('No office selected'); return; }
      const frame = document.getElementById('afd_frame');
      frame.src = `/.netlify/functions/getAFD?office=${encodeURIComponent(office)}`;
    }
  });
})();
