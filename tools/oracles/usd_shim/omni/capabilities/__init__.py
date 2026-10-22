"""``omni.capabilities``: the requirement each rule of the validator names (its code: ``BA.465``)."""


class Requirement:
    def __init__(self, code=None, display_name=None, message=None, path=None, compatibility=None, tags=(),
                 version=None, parameters=(), examples=()):
        self.code, self.display_name, self.message, self.path = code, display_name, message, path
        self.compatibility, self.tags, self.version = compatibility, tags, version
        self.parameters, self.examples = parameters, examples
