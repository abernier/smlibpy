"""``usd_validation_nvidia``: the base class of the validator's rule checker, collecting its issues."""


class Suggestion:
    def __init__(self, *args, **kwargs):
        pass


def register_requirements(*requirements):
    return lambda cls: cls


class Issue:
    def __init__(self, severity: str, message: str, requirement):
        self.severity, self.message, self.requirement = severity, message, requirement


class BaseRuleChecker:
    def __init__(self, *args, **kwargs):
        self.issues: list[Issue] = []

    def _AddFailedCheck(self, message=None, at=None, suggestion=None, code=None, requirement=None):
        self.issues.append(Issue("FAILURE", message, requirement))

    def _AddError(self, message=None, at=None, suggestion=None, code=None, requirement=None):
        self.issues.append(Issue("ERROR", message, requirement))

    def _AddWarning(self, message=None, at=None, suggestion=None, code=None, requirement=None):
        self.issues.append(Issue("WARNING", message, requirement))

    def _AddInfo(self, message=None, at=None, code=None, requirement=None):
        pass

    def GetIssues(self) -> list[Issue]:
        return self.issues
