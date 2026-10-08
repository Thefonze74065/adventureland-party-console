# Native blacklist catalog readiness

A successful first heartbeat establishes a running native client, but does not
establish that asynchronous catalog warming and delivery have completed. Opening
the blacklist picker before delivery can show an empty list and exhaust the
ordinary 15-second assertion deadline. A genuinely missing or incomplete catalog
must still fail, rather than be replaced with invented monster rows.

Wait up to 90 seconds for the actual coordinator catalog to contain more than
30 native monsters before opening the picker. Record their IDs as an artifact.
Keep the existing full-list scrolling, separate sprite/text inspection, Goo
selection and persisted blacklist checks unchanged. The fixture supplies no
catalog or interaction responses; native discovery remains the source.
