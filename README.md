# leasepool Architecture Atlas

An offline, interactive architectural documentation site for `leasepool` 0.1.3.

## Live site

[Open the leasepool Architecture Atlas](https://jackofsometrades99.github.io/leasepool-architecture-site/)

## Open it

Open `index.html` directly in a modern browser. No build step, package manager, web server, external font, CDN, or network connection is required.

For local serving instead:

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080`.

## What is included

- Orbitable/selectable perspective-3D system topology powered by the local `lease3d.js` engine
- Scenario paths for direct leases, WorkGrinder batches, expiry, broken executors, and process logging
- Animated request/result sequence diagrams
- Interactive lease lifecycle state machine
- Conceptual concurrency and event-loop-pressure simulator
- Adaptive sizing calculator
- WorkGrinder batching visualization
- Backend, failure-containment, internal-mechanism, and public-API maps
- Responsive mobile layout and reduced-motion control

## Source grounding

The narrative and diagrams were derived from the uploaded repository, primarily:

- `src/leasepool/manager.py`
- `src/leasepool/grinder.py`
- `src/leasepool/backends.py`
- `src/leasepool/_process_logging.py`
- `src/leasepool/exceptions.py`
- `src/leasepool/__init__.py`
- project tests, examples, README, and Sphinx documentation

The workload lab is explicitly a conceptual simulator. It illustrates the library's control rules; it is not a performance benchmark or a Python executor emulator.
