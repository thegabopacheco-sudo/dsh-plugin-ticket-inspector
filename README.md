# dsh-plugin-ticket-inspector — Ticket Inspector

Inspector de tickets para DeepSeek Harness: lista hilos de soporte, detecta tickets estancados o sin responder y resume cada conversacion para priorizar.

## Herramientas

Ver `docs/COMO-FUNCIONA.md` para el detalle.

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-ticket-inspector` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-ticket-inspector
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_TICKET_INSPECTOR_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\ticket-inspector\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
