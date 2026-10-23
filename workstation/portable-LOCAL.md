# portable workstation

- host: `__WORKSTATION_HOSTNAME__`
- connect through tailscale ssh as `coder`. no public ssh service runs in this container.
- the container uses `privileged: true` for docker-in-docker. treat its docker daemon as root access to the container.
- use only data approved for this host. record data residency requirements here before processing sensitive information.
